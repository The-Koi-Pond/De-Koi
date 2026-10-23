import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayWorldTickState } from "../../../contracts/types/roleplay-world-tick";
import {
  applyWorldTick,
  commandWorldTick,
  getWorldTickState,
  proposeWorldTick,
  WorldTickError,
} from "./world-tick-service";
import { offerWorldTickAfterScene, offerWorldTickForUserMessage } from "./world-tick-offers";
import { WORLD_TICK_METADATA_KEY } from "./world-tick-state";

const NOW = "2026-10-22T12:00:00.000Z";

type Message = Record<string, unknown> & { id: string };

function harness(responses: string[], chatOverrides: Record<string, unknown> = {}) {
  let chat: Record<string, unknown> = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "writer",
    characterIds: ["mara"],
    personaId: "chai",
    metadata: {},
    ...chatOverrides,
  };
  const messages: Message[] = [
    { id: "m1", role: "user", content: "We make camp under the bridge." },
    { id: "m2", role: "assistant", content: "Mara promises to send word to the ferryman by morning." },
  ];
  const requests: LlmRequest[] = [];
  let ids = 0;
  let beforeWrite: (() => void) | null = null;
  let failNextWrite = false;
  const metadata = () => chat.metadata as Record<string, unknown>;
  const storage = {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats") return chat;
      if (entity === "characters") return { id, data: { name: "Mara" } };
      if (entity === "personas") return { id, name: "Chai" };
      return null;
    }),
    listChatMessages: vi.fn(async () => messages),
    getChatMessage: vi.fn(async (id: string) => messages.find((message) => message.id === id) ?? null),
    createChatMessage: vi.fn(async (_chatId: string, value: Record<string, unknown>) => {
      const message = { ...value, id: String(value.id) };
      messages.push(message);
      return message;
    }),
    deleteChatMessage: vi.fn(async (id: string) => {
      const index = messages.findIndex((message) => message.id === id);
      if (index >= 0) messages.splice(index, 1);
      return { deleted: index >= 0 };
    }),
    getWorldState: vi.fn(async () => ({ date: "Day 3", time: "Dusk", location: "Old bridge" })),
    queryMemories: vi.fn(async () => []),
    queryKnowledgeEdges: vi.fn(async () => []),
    updateChatIfUnchanged: vi.fn(
      async (_chatId: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
        beforeWrite?.();
        beforeWrite = null;
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("disk full");
        }
        const expectedValue = (expected.metadata as Record<string, unknown>)[WORLD_TICK_METADATA_KEY] ?? null;
        const currentValue = metadata()[WORLD_TICK_METADATA_KEY] ?? null;
        if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) return { updated: false, chat };
        chat = { ...chat, metadata: { ...metadata(), ...(patch.metadata as Record<string, unknown>) } };
        return { updated: true, chat };
      },
    ),
  } as unknown as StorageGateway;
  const queue = [...responses];
  const llm = {
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return queue.shift() ?? '{"events":[]}';
    }),
  } as unknown as LlmGateway;
  const options = { now: () => NOW, createId: (prefix: string) => `${prefix}-${++ids}` };
  return {
    storage,
    llm,
    requests,
    messages,
    options,
    state: () => metadata()[WORLD_TICK_METADATA_KEY] as RoleplayWorldTickState | undefined,
    setState(state: RoleplayWorldTickState) {
      chat = { ...chat, metadata: { ...metadata(), [WORLD_TICK_METADATA_KEY]: state } };
    },
    beforeWrite(callback: () => void) {
      beforeWrite = callback;
    },
    failNextWrite() {
      failNextWrite = true;
    },
  };
}

const proposal = (...texts: string[]) => JSON.stringify({ events: texts.map((text) => ({ text, characters: [] })) });

async function reviewed(h: ReturnType<typeof harness>, decisions: Array<"accepted" | "rejected" | "deferred">) {
  let state = h.state()!;
  for (const [index, status] of decisions.entries()) {
    state = await commandWorldTick(
      h.storage,
      "chat-1",
      { type: "set_event_status", eventId: state.pending!.events[index]!.id, status },
      state.revision,
      h.options,
    );
  }
  return state;
}

describe("proposeWorldTick", () => {
  it("opens a review with the model's events and writes nothing to the chat", async () => {
    const h = harness([proposal("The ferryman got Mara's message and agreed to wait.", "Rain swelled the river.")]);

    const result = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "one night", guidance: "keep it quiet" },
      h.options,
    );

    expect(result.rejectedUnsafeEvents).toBe(0);
    expect(result.state.pending).toMatchObject({
      elapsed: "one night",
      guidance: "keep it quiet",
      anchorMessageId: "m2",
    });
    expect(result.state.pending!.events.map((event) => [event.text, event.status, event.source])).toEqual([
      ["The ferryman got Mara's message and agreed to wait.", "proposed", "model"],
      ["Rain swelled the river.", "proposed", "model"],
    ]);
    expect(h.messages).toHaveLength(2);
    expect(h.requests[0]!.connectionId).toBe("writer");
    const prompt = JSON.parse(String(h.requests[0]!.messages[1]!.content));
    expect(prompt.currentWorld).toEqual({ date: "Day 3", time: "Dusk", location: "Old bridge" });
    expect(prompt.userGuidance).toBe("keep it quiet");
  });

  it("drops events that decide something for the user's character", async () => {
    const h = harness([proposal("Chai decides to leave Mara behind.", "The bridge toll doubled overnight.")]);

    const result = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );

    expect(result.rejectedUnsafeEvents).toBe(1);
    expect(result.state.pending!.events.map((event) => event.text)).toEqual(["The bridge toll doubled overnight."]);
  });

  it("refuses to start a second review unless asked to replace the first", async () => {
    const h = harness([proposal("A"), proposal("B")]);
    await proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "an hour" }, h.options);

    await expect(
      proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "a week" }, h.options),
    ).rejects.toMatchObject({ code: "pending_exists" });

    const replaced = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a week", replacePending: true },
      h.options,
    );
    expect(replaced.state.pending).toMatchObject({ elapsed: "a week" });
    expect(replaced.state.pending!.events.map((event) => event.text)).toEqual(["B"]);
  });

  it("only works in Roleplay chats", async () => {
    const h = harness([], { mode: "conversation" });
    await expect(
      proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "a day" }, h.options),
    ).rejects.toMatchObject({ code: "not_roleplay" });
    expect(h.llm.complete).not.toHaveBeenCalled();
  });
});

describe("applyWorldTick", () => {
  it("needs a decision on every event first", async () => {
    const h = harness([proposal("A", "B")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    await reviewed(h, ["accepted"]);

    await expect(
      applyWorldTick(h.storage, { chatId: "chat-1", tickId: state.pending!.id }, h.options),
    ).rejects.toMatchObject({ code: "unreviewed_events" });
    expect(h.messages).toHaveLength(2);
  });

  it("writes only accepted events, keeps deferred ones for later, and never applies twice", async () => {
    const h = harness([
      proposal("The ferryman agreed to wait.", "Bandits camped upstream.", "The river froze."),
      proposal(),
    ]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "three days" },
      h.options,
    );
    const tickId = state.pending!.id;
    await reviewed(h, ["accepted", "deferred", "rejected"]);
    const withOwn = await commandWorldTick(
      h.storage,
      "chat-1",
      { type: "add_event", text: "A letter arrived for Mara." },
      undefined,
      h.options,
    );

    const applied = await applyWorldTick(
      h.storage,
      { chatId: "chat-1", tickId, expectedRevision: withOwn.revision },
      h.options,
    );
    await applyWorldTick(h.storage, { chatId: "chat-1", tickId }, h.options);

    const narration = h.messages.filter((message) => message.role === "narrator");
    expect(narration).toHaveLength(1);
    expect(narration[0]!.content).toBe(
      "*Time passes: three days.*\n\nWhile time passed:\n- The ferryman agreed to wait.\n- A letter arrived for Mara.",
    );
    expect(narration[0]!.extra).toMatchObject({ worldTick: { tickId, elapsed: "three days" } });
    expect(applied.pending).toBeNull();
    expect(applied.timeline.map((tick) => tick.events.map((event) => event.text))).toEqual([
      ["The ferryman agreed to wait.", "A letter arrived for Mara."],
    ]);
    expect(applied.deferred.map((event) => event.text)).toEqual(["Bandits camped upstream."]);

    // The put-off event comes back on the next tick and must be decided again.
    const next = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "an hour" },
      h.options,
    );
    expect(next.state.pending!.events.map((event) => [event.text, event.status, event.carried])).toEqual([
      ["Bandits camped upstream.", "proposed", true],
    ]);
    expect(next.state.deferred).toEqual([]);
    expect(JSON.parse(String(h.requests[1]!.messages[1]!.content)).alreadyPending).toEqual([
      "Bandits camped upstream.",
    ]);
  });

  it("finishes an apply that was cut off after writing its message without writing it again", async () => {
    const h = harness([proposal("A")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    const tickId = state.pending!.id;
    await reviewed(h, ["accepted"]);
    h.messages.push({
      id: `${tickId}-narration`,
      role: "narrator",
      content: "*Time passes: a day.*\n\nWhile time passed:\n- A",
    });

    const result = await applyWorldTick(h.storage, { chatId: "chat-1", tickId }, h.options);

    expect(result.timeline.map((tick) => tick.id)).toEqual([tickId]);
    expect(h.messages.filter((message) => message.role === "narrator")).toHaveLength(1);
    expect(h.storage.createChatMessage).not.toHaveBeenCalled();
  });

  it("counts an apply from another window as done", async () => {
    const h = harness([proposal("A")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    const tickId = state.pending!.id;
    await reviewed(h, ["accepted"]);
    const before = h.state()!;
    const otherWindow = {
      ...before,
      revision: before.revision + 1,
      pending: null,
      timeline: [
        {
          id: tickId,
          trigger: "manual" as const,
          boundaryKey: null,
          elapsed: "a day",
          messageId: `${tickId}-narration`,
          events: [],
          appliedAt: NOW,
        },
      ],
    };
    h.beforeWrite(() => h.setState(otherWindow));

    const result = await applyWorldTick(h.storage, { chatId: "chat-1", tickId }, h.options);

    expect(result.timeline.map((tick) => tick.id)).toEqual([tickId]);
    expect(h.messages.filter((message) => message.role === "narrator")).toHaveLength(1);
  });

  it("removes its message again when the review changed underneath it", async () => {
    const h = harness([proposal("A")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    await reviewed(h, ["accepted"]);
    const before = h.state()!;
    h.beforeWrite(() =>
      h.setState({ ...before, revision: before.revision + 1, pending: { ...before.pending!, elapsed: "a week" } }),
    );

    await expect(
      applyWorldTick(h.storage, { chatId: "chat-1", tickId: state.pending!.id }, h.options),
    ).rejects.toMatchObject({ code: "stale_revision" });
    expect(h.messages.filter((message) => message.role === "narrator")).toHaveLength(0);
  });

  it("removes its message again when saving the tick fails", async () => {
    const h = harness([proposal("A")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    await reviewed(h, ["accepted"]);
    h.failNextWrite();

    const error = await applyWorldTick(h.storage, { chatId: "chat-1", tickId: state.pending!.id }, h.options).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WorldTickError);
    expect(h.messages.filter((message) => message.role === "narrator")).toHaveLength(0);
    expect(h.state()!.pending).not.toBeNull();
  });
});

describe("discarding a review", () => {
  it("keeps put-off events and cleans up a message left by a cut-off apply", async () => {
    const h = harness([proposal("A", "B")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    const tickId = state.pending!.id;
    const decided = await reviewed(h, ["deferred", "accepted"]);
    // An apply that wrote its message and then lost the tab.
    h.messages.push({ id: `${tickId}-narration`, role: "narrator", content: "*Time passes: a day.*" });

    const discarded = await commandWorldTick(
      h.storage,
      "chat-1",
      { type: "discard_pending" },
      decided.revision,
      h.options,
    );

    expect(discarded.pending).toBeNull();
    expect(discarded.timeline).toEqual([]);
    expect(discarded.deferred.map((event) => event.text)).toEqual(["A"]);
    expect(h.messages.some((message) => message.id === `${tickId}-narration`)).toBe(false);
  });
});

describe("model failures", () => {
  it("passes the provider's own message through instead of calling it bad output", async () => {
    const h = harness([]);
    (h.llm.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Failed to start Claude Code. Install @anthropic-ai/claude-code, run `claude login`."),
    );

    await expect(
      proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "a day" }, h.options),
    ).rejects.toMatchObject({ code: "model_failed", message: expect.stringContaining("claude login") });
    expect(h.state()?.pending ?? null).toBeNull();
  });
});

describe("hardening", () => {
  it("rewrites a leftover message when the review changed after a cut-off apply", async () => {
    const h = harness([proposal("A", "B")]);
    const { state } = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );
    const tickId = state.pending!.id;
    await reviewed(h, ["accepted", "accepted"]);
    // Written by an apply that lost its tab, before the user rejected B.
    h.messages.push({
      id: `${tickId}-narration`,
      role: "narrator",
      content: "*Time passes: a day.*\n\nWhile time passed:\n- A\n- B",
    });
    const now = h.state()!;
    await commandWorldTick(
      h.storage,
      "chat-1",
      { type: "set_event_status", eventId: now.pending!.events[1]!.id, status: "rejected" },
      now.revision,
      h.options,
    );

    await applyWorldTick(h.storage, { chatId: "chat-1", tickId }, h.options);

    const narration = h.messages.filter((message) => message.role === "narrator");
    expect(narration).toHaveLength(1);
    expect(narration[0]!.content).toBe("*Time passes: a day.*\n\nWhile time passed:\n- A");
  });

  it("gives up at the deadline even when the model transport ignores the abort", async () => {
    const h = harness([]);
    (h.llm.complete as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise(() => undefined));

    await expect(
      proposeWorldTick(
        { storage: h.storage, llm: h.llm },
        { chatId: "chat-1", elapsed: "a day" },
        { ...h.options, timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(h.state()?.pending ?? null).toBeNull();
  });

  it("keeps a round with extra fields, too many events and an over-long sentence", async () => {
    const long = `The tide went out further than anyone aboard could remember. ${"Gulls wheeled over the flats. ".repeat(12)}`;
    const h = harness([
      JSON.stringify({
        events: [
          { text: long, characters: ["Mara"], mood: "eerie" },
          ...["B", "C", "D", "E", "F"].map((text) => ({ text })),
        ],
        note: "extra",
      }),
    ]);

    const result = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "a day" },
      h.options,
    );

    const texts = result.state.pending!.events.map((event) => event.text);
    expect(texts).toHaveLength(5);
    expect(texts[0]!.length).toBeLessThanOrEqual(280);
    expect(texts[0]!.endsWith(".")).toBe(true);
    expect(texts.slice(1)).toEqual(["B", "C", "D", "E"]);
  });

  it("reports a tracker that can't be read instead of guessing without it", async () => {
    const h = harness([proposal("A")]);
    (h.storage.getWorldState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("tracker store locked"));

    await expect(
      proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "a day" }, h.options),
    ).rejects.toMatchObject({ code: "source_unavailable", message: expect.stringContaining("tracker store locked") });
    expect(h.llm.complete).not.toHaveBeenCalled();
  });
});

describe("offers at story boundaries", () => {
  const skip = { chatId: "chat-1", content: "*Three days later,* I return.", previousMessageId: "m2" };

  it("offers a boundary once, however often the callback fires", async () => {
    const h = harness([], { name: "The bridge" });

    const [first, second] = await Promise.all([
      offerWorldTickAfterScene(h.storage, { originChatId: "chat-1", sceneChatId: "scene-1" }, h.options),
      offerWorldTickAfterScene(h.storage, { originChatId: "chat-1", sceneChatId: "scene-1" }, h.options),
    ]);
    const third = await offerWorldTickAfterScene(
      h.storage,
      { originChatId: "chat-1", sceneChatId: "scene-1" },
      h.options,
    );

    expect([first.offered, second.offered].sort()).toEqual([false, true]);
    expect(third).toEqual({ offered: false, reason: "already_offered" });
    expect(h.state()!.offer).toMatchObject({ trigger: "scene_concluded", label: "The bridge", elapsed: "" });
    expect(h.state()!.offeredBoundaries).toHaveLength(1);
    expect(h.llm.complete).not.toHaveBeenCalled();
    expect(h.messages).toHaveLength(2);
  });

  it("never brings back a dismissed offer, even when the same turn is retried", async () => {
    const h = harness([]);
    const offered = await offerWorldTickForUserMessage(h.storage, skip, h.options);
    expect(offered).toMatchObject({ offered: true, offer: { trigger: "time_skip", elapsed: "three days" } });

    await commandWorldTick(
      h.storage,
      "chat-1",
      { type: "dismiss_offer", offerId: h.state()!.offer!.id },
      undefined,
      h.options,
    );
    const retried = await offerWorldTickForUserMessage(h.storage, skip, h.options);

    expect(h.state()!.offer).toBeNull();
    expect(retried).toEqual({ offered: false, reason: "already_offered" });
  });

  it("stays quiet when the chat's switch is off, and turning it off withdraws a waiting offer", async () => {
    const h = harness([]);
    await offerWorldTickForUserMessage(h.storage, skip, h.options);

    await commandWorldTick(h.storage, "chat-1", { type: "set_offers_enabled", enabled: false }, undefined, h.options);
    const later = await offerWorldTickForUserMessage(
      h.storage,
      { ...skip, content: "A week later, the river floods.", previousMessageId: "m3" },
      h.options,
    );

    expect(h.state()).toMatchObject({ offersEnabled: false, offer: null });
    expect(later).toEqual({ offered: false, reason: "offers_off" });

    await commandWorldTick(h.storage, "chat-1", { type: "set_offers_enabled", enabled: true }, undefined, h.options);
    expect(h.state()!.offer).toBeNull();
  });

  it("does not offer while a time skip is already waiting for review", async () => {
    const h = harness([proposal("Rain swelled the river.")]);
    await proposeWorldTick({ storage: h.storage, llm: h.llm }, { chatId: "chat-1", elapsed: "a day" }, h.options);

    const result = await offerWorldTickForUserMessage(h.storage, skip, h.options);

    expect(result).toEqual({ offered: false, reason: "review_open" });
    expect(h.state()!.offer).toBeNull();
  });

  it("only offers in Roleplay chats", async () => {
    const h = harness([], { mode: "conversation" });

    expect(await offerWorldTickForUserMessage(h.storage, skip, h.options)).toEqual({
      offered: false,
      reason: "not_roleplay",
    });
    expect(h.storage.updateChatIfUnchanged).not.toHaveBeenCalled();
  });

  it("never offers or writes when the chat is just opened", async () => {
    const h = harness([]);
    h.messages.push({ id: "m3", role: "user", content: "*Three days later,* I return." });

    const state = await getWorldTickState(h.storage, "chat-1", h.options);

    expect(state.offer).toBeNull();
    expect(h.storage.updateChatIfUnchanged).not.toHaveBeenCalled();
    expect(h.llm.complete).not.toHaveBeenCalled();
  });

  it("taking an offer records where the tick came from, and the narration looks back at the skip", async () => {
    const h = harness([proposal("The ferryman sold his boat.")]);
    await offerWorldTickForUserMessage(h.storage, skip, h.options);
    const offerId = h.state()!.offer!.id;

    const proposed = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "three days", offerId },
      h.options,
    );
    expect(proposed.state.offer).toBeNull();
    expect(proposed.state.pending).toMatchObject({ trigger: "time_skip", boundaryKey: offerId });

    const state = await reviewed(h, ["accepted"]);
    const applied = await applyWorldTick(
      h.storage,
      { chatId: "chat-1", tickId: state.pending!.id, expectedRevision: state.revision },
      h.options,
    );

    expect(applied.timeline.at(-1)).toMatchObject({ trigger: "time_skip", boundaryKey: offerId });
    expect(h.messages.at(-1)!.content).toBe("*Meanwhile, off-screen (three days):*\n- The ferryman sold his boat.");
    expect(await offerWorldTickForUserMessage(h.storage, skip, h.options)).toEqual({
      offered: false,
      reason: "already_offered",
    });
  });

  it("reads a slice-1 state (no offer fields) as offers on, nothing waiting, manual ticks", async () => {
    const h = harness([]);
    h.setState({
      version: 1,
      revision: 7,
      pending: null,
      deferred: [],
      timeline: [
        { id: "t1", trigger: "manual", elapsed: "a day", messageId: "t1-narration", events: [], appliedAt: NOW },
      ],
      updatedAt: NOW,
    } as unknown as RoleplayWorldTickState);

    const state = await getWorldTickState(h.storage, "chat-1", h.options);
    expect(state).toMatchObject({ revision: 7, offersEnabled: true, offer: null, offeredBoundaries: [] });
    expect(state.timeline[0]).toMatchObject({ trigger: "manual", boundaryKey: null });
    expect(await offerWorldTickForUserMessage(h.storage, skip, h.options)).toMatchObject({ offered: true });
  });

  it("suggesting again keeps answering the same boundary", async () => {
    const h = harness([proposal("The ferryman sold his boat."), proposal("Gulls nested in the rigging.")]);
    await offerWorldTickForUserMessage(h.storage, skip, h.options);
    const offerId = h.state()!.offer!.id;
    await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "three days", offerId },
      h.options,
    );

    const again = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "three days", replacePending: true },
      h.options,
    );

    expect(again.state.pending).toMatchObject({ trigger: "time_skip", boundaryKey: offerId });
    expect(again.state.pending!.events.map((event) => event.text)).toEqual(["Gulls nested in the rigging."]);
  });

  it("a manual tick leaves a waiting offer alone", async () => {
    const h = harness([proposal("Rain swelled the river.")]);
    await offerWorldTickForUserMessage(h.storage, skip, h.options);

    const proposed = await proposeWorldTick(
      { storage: h.storage, llm: h.llm },
      { chatId: "chat-1", elapsed: "an hour" },
      h.options,
    );

    expect(proposed.state.pending).toMatchObject({ trigger: "manual", boundaryKey: null });
    expect(proposed.state.offer).not.toBeNull();
  });
});
