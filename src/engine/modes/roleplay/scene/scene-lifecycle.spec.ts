import { describe, expect, it, vi } from "vitest";

import type { CanonicalMemoryInput } from "../../../contracts/types/memory";
import { createRoleplayScene } from "./scene-create";
import { concludeRoleplayScene, discardRoleplayScene, reopenRoleplayScene } from "./scene-lifecycle";
import { SCENE_PLAN_SYSTEM_PROMPT } from "./scene-prompts";
import {
  createFakeSceneStorage,
  scriptedLlm,
  systemOf,
  THREE_SENTENCE_SUMMARY,
  userOf,
  wholeSummaryJson,
  type FakeSceneStorageSeed,
} from "./scene-storage.fake";

type JsonRecord = Record<string, unknown>;

const SECTION_SUMMARY = "Mara and the user searched the flooded archive and saved the ledger.";

function sceneFixture(
  options: { origin?: JsonRecord; scene?: JsonRecord; messages?: JsonRecord[] } & Omit<
    FakeSceneStorageSeed,
    "messages"
  > = {},
) {
  const { origin, scene, messages, ...seed } = options;
  return createFakeSceneStorage({
    chats: [
      {
        id: "origin",
        name: "Origin",
        mode: "conversation",
        characterIds: ["mara"],
        connectedChatId: "scene",
        metadata: { activeSceneChatId: "scene", sceneBusyCharIds: ["mara"] },
        ...origin,
      },
      {
        id: "scene",
        name: "Scene: The Archive",
        mode: "roleplay",
        characterIds: ["mara"],
        connectionId: "main",
        connectedChatId: "origin",
        metadata: {
          sceneOriginChatId: "origin",
          sceneStatus: "active",
          sceneDescription: "A flooded archive.",
          activeAgentIds: ["expression"],
          enableAgents: true,
        },
        ...scene,
      },
    ],
    connections: [{ id: "main", provider: "openai", model: "model-1", enabled: true }],
    characters: [{ id: "mara", data: { name: "Mara", extensions: {} } }],
    messages: {
      scene: messages ?? [
        { id: "opening", role: "assistant", characterId: "mara", content: "Mara opens the flooded archive." },
        { id: "choice", role: "user", content: "I rescue the ledger." },
      ],
    },
    ...seed,
  });
}

function summarizingLlm(whole: string | ((call: number) => string) = wholeSummaryJson(THREE_SENTENCE_SUMMARY)) {
  let wholeCalls = 0;
  return scriptedLlm((_request, call) => {
    if (call === "section") return SECTION_SUMMARY;
    wholeCalls += 1;
    return typeof whole === "string" ? whole : whole(wholeCalls);
  });
}

function priorEpisode(index: number): CanonicalMemoryInput {
  const ids = [`prior-${index}-a`, `prior-${index}-b`];
  return {
    id: `prior-episode-${index}`,
    kind: "episode",
    status: "active",
    scope: { kind: "chat", id: "origin" },
    title: `Prior episode ${index}`,
    content: `Prior episode ${index}.`,
    confidence: 0.9,
    provenance: { sourceChatId: "origin", messageIds: ids },
    tags: ["story-continuity", "episode"],
    payload: {
      storyProjectionVersion: 1,
      level: "episode",
      ownerChatId: "origin",
      coverageId: `prior-coverage-${index}`,
      sourceFingerprint: `prior-fingerprint-${index}`,
      messageIds: ids,
      sourceMessages: [{ id: ids[0], role: "user", content: "Earlier.", createdAt: `2026-08-0${index}T00:00:00.000Z` }],
      firstMessageId: ids[0],
      lastMessageId: ids[1],
      sourceEpisodeIds: [],
      sections: {
        events: [],
        choices: [],
        relationshipShifts: [],
        promises: [],
        reveals: [],
        unresolvedHooks: [],
        currentState: [],
      },
      summarizer: { version: "story-projection-v1", completedAt: `2026-08-0${index}T00:00:00.000Z` },
    },
    createdAt: `2026-08-0${index}T00:00:00.000Z`,
    updatedAt: `2026-08-0${index}T00:00:00.000Z`,
  };
}

const STORY_ORIGIN = { mode: "roleplay", metadata: { activeSceneChatId: "scene", enableMemoryRecall: true } };

describe("concluding a scene", () => {
  it("writes one hidden return message, a history entry and a memory per character, then concludes", async () => {
    const fixture = sceneFixture();
    const model = summarizingLlm();

    const result = await concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" });

    expect(result).toEqual({ summary: THREE_SENTENCE_SUMMARY, originChatId: "origin" });
    expect(fixture.messages("origin")).toEqual([
      expect.objectContaining({
        role: "assistant",
        characterId: null,
        content: `The scene "The Archive" concluded.\n\n${THREE_SENTENCE_SUMMARY}`,
        extra: { hiddenFromAI: true, hiddenFromAi: true, sceneChatId: "scene" },
      }),
    ]);
    expect(fixture.metadata("origin")).toMatchObject({
      roleplaySceneHistory: [
        { sceneChatId: "scene", concludedAt: expect.any(String), summary: THREE_SENTENCE_SUMMARY },
      ],
      lastRoleplaySceneSummary: THREE_SENTENCE_SUMMARY,
      lastRoleplaySceneOptions: { activeAgentIds: ["expression"], enableAgents: true },
      activeSceneChatId: null,
      sceneBusyCharIds: null,
    });
    const memories = (fixture.character("mara")?.data as JsonRecord).extensions as JsonRecord;
    expect(memories.characterMemories).toEqual([
      {
        from: "The Archive",
        fromCharId: null,
        sceneChatId: "scene",
        originChatId: "origin",
        summary: expect.stringMatching(/^\[Scene on \d{4}-\d{2}-\d{2}: The Archive\] Mara entered/),
        createdAt: expect.any(String),
      },
    ]);
    expect(fixture.chat("scene")).toMatchObject({ connectedChatId: null, metadata: { sceneStatus: "concluded" } });
    expect(fixture.chat("origin")?.connectedChatId).toBeNull();
  });

  it("summarizes every section before the whole scene, on the scene's connection with reasoning off", async () => {
    const filler = "the lanterns hum while the archive keeps flooding around them. ".repeat(200);
    const fixture = sceneFixture({
      messages: [
        { id: "a", role: "assistant", content: `BEGINNING_BEAT ${filler}` },
        { id: "b", role: "user", content: `MIDDLE_BEAT ${filler}` },
        { id: "c", role: "assistant", content: `ENDING_BEAT ${filler}` },
      ],
    });
    const model = scriptedLlm((request, call) => {
      if (call === "section") {
        const marker = /(BEGINNING|MIDDLE|ENDING)_BEAT/.exec(userOf(request))?.[1] ?? "EXTRA";
        return `Section about ${marker}.`;
      }
      expect(userOf(request)).toContain("Section 1: Section about BEGINNING.");
      return wholeSummaryJson(THREE_SENTENCE_SUMMARY);
    });

    await concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" });

    const kinds = model.requests.map((request) => (systemOf(request).includes("one section") ? "section" : "whole"));
    expect(kinds.filter((kind) => kind === "section").length).toBeGreaterThanOrEqual(3);
    expect(kinds.at(-1)).toBe("whole");
    expect(kinds.indexOf("whole")).toBe(kinds.length - 1);
    for (const request of model.requests) {
      expect(request.connectionId).toBe("main");
      expect(request.parameters).toMatchObject({
        reasoningEffort: "none",
        reasoning_effort: "none",
        customParameters: { reasoning_effort: "none", reasoning: { exclude: true } },
      });
    }
    expect(model.requests[0]!.parameters).toMatchObject({ temperature: 0.45, maxTokens: 700 });
    expect(model.requests.at(-1)!.parameters).toMatchObject({ temperature: 0.5, maxTokens: 1400 });
  });

  it("resolves a random connection once, before the first call", async () => {
    const fixture = sceneFixture({
      scene: { connectionId: null },
      connections: [
        { id: "pool-a", enabled: true, useForRandom: true },
        { id: "pool-b", enabled: true, useForRandom: true },
      ],
    });
    const model = summarizingLlm();
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValue(0);

    await concludeRoleplayScene(
      { storage: fixture.storage, llm: model.llm },
      { sceneChatId: "scene", connectionId: "random" },
    );

    random.mockRestore();
    expect(model.requests.length).toBeGreaterThan(1);
    expect(model.requests.map((request) => request.connectionId)).toEqual(model.requests.map(() => "pool-b"));
  });

  it("stores the scene as one story episode from the same summary pass", async () => {
    const fixture = sceneFixture({ origin: STORY_ORIGIN });
    const model = summarizingLlm(
      wholeSummaryJson(THREE_SENTENCE_SUMMARY, { choices: ["Mara chose to rescue the ledger."] }),
    );

    await concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" });

    expect(model.requests).toHaveLength(2);
    expect(fixture.memories).toEqual([
      expect.objectContaining({
        kind: "episode",
        scope: { kind: "chat", id: "origin" },
        provenance: expect.objectContaining({ sceneId: "scene", messageIds: ["opening", "choice"] }),
        payload: expect.objectContaining({
          boundaryReason: "scene_conclusion",
          sections: expect.objectContaining({
            choices: [{ text: "Mara chose to rescue the ledger.", sourceMessageIds: ["opening", "choice"] }],
          }),
          summarizer: expect.objectContaining({ connectionId: "main", provider: "openai", model: "model-1" }),
        }),
      }),
    ]);
  });

  it("concludes and leaves a retryable parent-arc job when enqueueing the arc fails", async () => {
    const fixture = sceneFixture({ origin: STORY_ORIGIN, failArcEnqueue: true });
    for (let index = 1; index <= 3; index += 1) await fixture.storage.createMemory?.(priorEpisode(index));

    await concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: "scene" });

    expect(fixture.metadata("scene").sceneStatus).toBe("concluded");
    expect(fixture.jobs).toContainEqual(
      expect.objectContaining({ followUp: "arc_enqueue", status: "retryable", projectionMemoryId: expect.any(String) }),
    );
  });

  it("stays active and writes nothing back when the story follow-up can't be written", async () => {
    const fixture = sceneFixture({ origin: STORY_ORIGIN, failFollowUpWrite: true });
    for (let index = 1; index <= 3; index += 1) await fixture.storage.createMemory?.(priorEpisode(index));

    await expect(
      concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: "scene" }),
    ).rejects.toThrow("follow-up write failed");

    expect(fixture.messages("origin")).toEqual([]);
    expect(fixture.metadata("scene").sceneStatus).toBe("active");
  });

  it("stays active when Story Continuity is on but canonical memory can't be written", async () => {
    const fixture = sceneFixture({ origin: STORY_ORIGIN });
    (fixture.storage as { createMemory?: unknown }).createMemory = undefined;
    const model = summarizingLlm();

    await expect(
      concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" }),
    ).rejects.toThrow("Story Continuity is enabled, but canonical memory persistence is unavailable");

    expect(model.requests).toHaveLength(0);
    expect(fixture.messages("origin")).toEqual([]);
    expect(fixture.metadata("scene").sceneStatus).toBe("active");
  });

  it("stays active and writes nothing when the summary fails, keeping the provider's code", async () => {
    const fixture = sceneFixture();
    const llm = {
      ...summarizingLlm().llm,
      complete: async () => {
        throw Object.assign(new Error("Quota exceeded."), { code: "llm_quota_exceeded" });
      },
    };

    await expect(
      concludeRoleplayScene({ storage: fixture.storage, llm }, { sceneChatId: "scene" }),
    ).rejects.toMatchObject({
      message: "Scene summary generation failed: Quota exceeded.",
      code: "llm_quota_exceeded",
    });

    expect(fixture.messages("origin")).toEqual([]);
    expect(fixture.metadata("origin")).not.toHaveProperty("roleplaySceneHistory");
    expect(fixture.metadata("scene").sceneStatus).toBe("active");
  });

  it.each([
    ["an empty final summary", "   ", "empty scene summary"],
    ["JSON without a summary", JSON.stringify({ sections: {} }), "malformed structured scene summary JSON"],
    ["broken fenced JSON", '```json\n{"summary": "The archive closes"', "malformed structured scene summary JSON"],
    ["sections that aren't lists", JSON.stringify({ summary: "Done.", sections: { events: "x" } }), "malformed"],
  ])("refuses %s", async (_label, whole, reason) => {
    const fixture = sceneFixture();

    await expect(
      concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm(whole).llm }, { sceneChatId: "scene" }),
    ).rejects.toThrow(new RegExp(`^Scene summary generation failed: .*${reason}`));
    expect(fixture.messages("origin")).toEqual([]);
  });

  it("accepts plain prose from older providers", async () => {
    const fixture = sceneFixture();

    const result = await concludeRoleplayScene(
      { storage: fixture.storage, llm: summarizingLlm(THREE_SENTENCE_SUMMARY).llm },
      { sceneChatId: "scene" },
    );

    expect(result.summary).toBe(THREE_SENTENCE_SUMMARY);
  });

  it("asks again when the summary runs long, keeping late facts", async () => {
    const fixture = sceneFixture();
    const long = Array.from({ length: 60 }, (_, index) => `Middle detail ${index + 1} keeps going.`).join(" ");
    const model = summarizingLlm((call) =>
      call === 1
        ? `${long} ENDING_FACT Mara keeps the ledger.`
        : `${THREE_SENTENCE_SUMMARY} ENDING_FACT Mara keeps the ledger.`,
    );

    const result = await concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" });

    const retry = model.requests.at(-1)!;
    expect(systemOf(retry)).toContain("ran past 220 words");
    expect(userOf(retry)).toContain("Middle detail 60");
    expect(retry.parameters).toMatchObject({ temperature: 0.35, maxTokens: 2800 });
    expect(result.summary).toContain("ENDING_FACT Mara keeps the ledger.");
  });

  it("hard-caps a summary that stays long, keeping its start and end", async () => {
    const fixture = sceneFixture();
    const oversized = `OPENING_FACT ${"word ".repeat(300)}ENDING_FACT closes it.`;

    const result = await concludeRoleplayScene(
      { storage: fixture.storage, llm: summarizingLlm(oversized).llm },
      { sceneChatId: "scene" },
    );

    expect(result.summary.split(/\s+/).length).toBeLessThanOrEqual(220);
    expect(result.summary).toContain("OPENING_FACT");
    expect(result.summary).toContain("ENDING_FACT closes it.");
    expect(result.summary).toContain("…");
  });

  it("asks again when a substantial scene gets a too-brief summary, and fails if it stays brief", async () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 ? "user" : "assistant",
      content: `Beat ${index} moves the scene forward.`,
    }));
    const recovered = sceneFixture({ messages });
    const brief = sceneFixture({ messages });
    const recoveredModel = summarizingLlm((call) => (call === 1 ? "Mara wins." : THREE_SENTENCE_SUMMARY));

    const result = await concludeRoleplayScene(
      { storage: recovered.storage, llm: recoveredModel.llm },
      { sceneChatId: "scene" },
    );

    expect(userOf(recoveredModel.requests.at(-1)!)).toContain("Earlier answer:\nMara wins.");
    expect(result.summary).toBe(THREE_SENTENCE_SUMMARY);
    await expect(
      concludeRoleplayScene(
        { storage: brief.storage, llm: summarizingLlm("Mara wins.").llm },
        { sceneChatId: "scene" },
      ),
    ).rejects.toThrow("The model returned an incomplete scene summary. Try again, or switch to a stronger model.");
    expect(brief.metadata("scene").sceneStatus).toBe("active");
  });

  it("retries an empty provider answer once with a larger budget", async () => {
    const fixture = sceneFixture();
    let failed = false;
    const model = scriptedLlm((_request, call) => {
      if (call === "section" && !failed) {
        failed = true;
        throw Object.assign(new Error("Provider response was rejected"), {
          details: { providerMetadata: { note: "reasoning but no final assistant text" } },
        });
      }
      return call === "section" ? SECTION_SUMMARY : wholeSummaryJson(THREE_SENTENCE_SUMMARY);
    });

    await concludeRoleplayScene({ storage: fixture.storage, llm: model.llm }, { sceneChatId: "scene" });

    expect(model.requests.map((request) => request.parameters?.maxTokens)).toEqual([700, 2048, 1400]);
  });

  it("removes speaker labels from the summary", async () => {
    const fixture = sceneFixture();

    const result = await concludeRoleplayScene(
      { storage: fixture.storage, llm: summarizingLlm(`Assistant: ${THREE_SENTENCE_SUMMARY}`).llm },
      { sceneChatId: "scene" },
    );

    expect(result.summary).toBe(THREE_SENTENCE_SUMMARY);
  });

  it("refuses a chat that isn't a scene", async () => {
    const fixture = sceneFixture({ scene: { metadata: {} } });

    await expect(
      concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: "scene" }),
    ).rejects.toThrow("Not a scene chat");
  });

  // Decision 3.
  it("keeps one return message, history entry and memory when a reopened scene ends again", async () => {
    const fixture = sceneFixture();
    const capabilities = { storage: fixture.storage, llm: summarizingLlm().llm };

    await concludeRoleplayScene(capabilities, { sceneChatId: "scene" });
    await reopenRoleplayScene(fixture.storage, { sceneChatId: "scene" });
    await fixture.storage.createChatMessage("scene", { role: "user", content: "One more thing." });
    await concludeRoleplayScene(capabilities, { sceneChatId: "scene" });

    expect(fixture.messages("origin")).toHaveLength(1);
    expect(fixture.metadata("origin").roleplaySceneHistory).toHaveLength(1);
    const extensions = (fixture.character("mara")?.data as JsonRecord).extensions as JsonRecord;
    expect(extensions.characterMemories).toHaveLength(1);
  });

  it("replaces the return message left by an earlier attempt that failed later", async () => {
    const fixture = sceneFixture();
    const capabilities = { storage: fixture.storage, llm: summarizingLlm().llm };
    const update = fixture.storage.update.bind(fixture.storage);
    vi.spyOn(fixture.storage, "update").mockImplementationOnce(async (entity, id, patch) => {
      if (entity === "characters") throw new Error("character write failed");
      return update(entity, id, patch);
    });

    await expect(concludeRoleplayScene(capabilities, { sceneChatId: "scene" })).rejects.toThrow(
      "character write failed",
    );
    expect(fixture.metadata("scene").sceneStatus).toBe("active");
    await concludeRoleplayScene(capabilities, { sceneChatId: "scene" });

    expect(fixture.messages("origin")).toHaveLength(1);
  });

  // Decision 2.
  it("gives the origin its earlier link back when the scene ends", async () => {
    const fixture = sceneFixture({
      origin: { metadata: { activeSceneChatId: "scene" } },
    });
    await fixture.storage.create("chats", { name: "Linked roleplay", mode: "roleplay", connectedChatId: "origin" });
    const linked = fixture.createdChats.at(-1)!;
    await fixture.storage.patchChatMetadata("origin", { scenePreviousConnectedChatId: linked.id });

    await concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: "scene" });

    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: linked.id,
      metadata: { scenePreviousConnectedChatId: null },
    });
  });

  it("drops the earlier link when that chat no longer links back", async () => {
    const fixture = sceneFixture({
      origin: { metadata: { activeSceneChatId: "scene", scenePreviousConnectedChatId: "gone" } },
    });

    await concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: "scene" });

    expect(fixture.chat("origin")?.connectedChatId).toBeNull();
  });
});

describe("discarding a scene", () => {
  it("saves its options, frees the origin, then deletes the transcript in one bulk delete before the chat", async () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      id: `m-${index}`,
      role: "user",
      content: `Beat ${index}`,
    }));
    const fixture = sceneFixture({ messages });

    await expect(discardRoleplayScene(fixture.storage, { sceneChatId: "scene" })).resolves.toEqual({
      originChatId: "origin",
    });

    expect(fixture.bulkDeletes).toEqual([{ chatId: "scene", messageIds: messages.map((message) => message.id) }]);
    expect(fixture.singleDeletes).toEqual([]);
    expect(fixture.calls.indexOf("bulkDeleteChatMessages:scene")).toBeLessThan(
      fixture.calls.indexOf("delete:chats:scene"),
    );
    expect(fixture.chat("scene")).toBeUndefined();
    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: null,
      metadata: {
        activeSceneChatId: null,
        sceneBusyCharIds: null,
        lastRoleplaySceneOptions: { activeAgentIds: ["expression"], enableAgents: true },
      },
    });
    expect(fixture.metadata("origin")).not.toHaveProperty("roleplaySceneHistory");
  });

  it("leaves another active scene's pointers alone", async () => {
    const fixture = sceneFixture({
      origin: {
        connectedChatId: "other-scene",
        metadata: { activeSceneChatId: "other-scene", sceneBusyCharIds: ["x"] },
      },
      scene: { metadata: { sceneOriginChatId: "origin", sceneStatus: "concluded" } },
    });

    await discardRoleplayScene(fixture.storage, { sceneChatId: "scene" });

    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: "other-scene",
      metadata: { activeSceneChatId: "other-scene", sceneBusyCharIds: ["x"] },
    });
  });
});

describe("reopening a scene", () => {
  it("makes a concluded scene the origin's active scene again and relinks both", async () => {
    const fixture = sceneFixture({
      origin: { connectedChatId: "linked-rp", metadata: { activeSceneChatId: null } },
      scene: { connectedChatId: null, metadata: { sceneOriginChatId: "origin", sceneStatus: "concluded" } },
    });

    await expect(reopenRoleplayScene(fixture.storage, { sceneChatId: "scene" })).resolves.toEqual({
      originChatId: "origin",
    });

    expect(fixture.chat("scene")).toMatchObject({ connectedChatId: "origin", metadata: { sceneStatus: "active" } });
    expect(fixture.chat("origin")).toMatchObject({
      connectedChatId: "scene",
      metadata: { activeSceneChatId: "scene", sceneBusyCharIds: ["mara"], scenePreviousConnectedChatId: "linked-rp" },
    });
  });

  it("refuses when the origin already has another active scene", async () => {
    const fixture = sceneFixture({
      origin: { connectedChatId: "other-scene", metadata: { activeSceneChatId: "other-scene" } },
      scene: { metadata: { sceneOriginChatId: "origin", sceneStatus: "concluded" } },
    });

    await expect(reopenRoleplayScene(fixture.storage, { sceneChatId: "scene" })).rejects.toThrow(
      "This conversation already has an active scene. Conclude or discard that scene first.",
    );
    expect(fixture.metadata("scene").sceneStatus).toBe("concluded");
    expect(fixture.chat("origin")?.connectedChatId).toBe("other-scene");
  });
});

describe("a scene's whole life", () => {
  // Decision 2, end to end: a Conversation linked to a Roleplay keeps that link after its scene.
  it("keeps the origin's Roleplay link through start and end", async () => {
    const fixture = createFakeSceneStorage({
      chats: [
        { id: "texts", mode: "conversation", characterIds: ["mara"], connectedChatId: "rp", metadata: {} },
        { id: "rp", mode: "roleplay", characterIds: ["mara"], connectedChatId: "texts", metadata: {} },
      ],
      connections: [{ id: "main", enabled: true }],
      messages: { texts: [{ id: "t-1", role: "user", content: "Hi" }] },
    });
    const plan = {
      name: "Scene: Pier",
      description: "A rainy pier.",
      scenario: "Rain.",
      firstMessage: "",
      characterIds: ["mara"],
      systemPrompt: SCENE_PLAN_SYSTEM_PROMPT,
      rating: "sfw" as const,
      relationshipHistory: "",
    };
    const scene = await createRoleplayScene(fixture.storage, {
      originChatId: "texts",
      plan,
      initiatorCharId: null,
      connectionId: "main",
      openingMode: "planned",
    });
    expect(fixture.chat("texts")?.connectedChatId).toBe(scene.chatId);

    await concludeRoleplayScene({ storage: fixture.storage, llm: summarizingLlm().llm }, { sceneChatId: scene.chatId });

    expect(fixture.chat("texts")?.connectedChatId).toBe("rp");
    expect(fixture.chat("rp")?.connectedChatId).toBe("texts");
  });
});
