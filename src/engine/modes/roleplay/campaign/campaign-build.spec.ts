// Durable test rationale: the build writes four kinds of rows and must remove every one of them when a later write
// fails (a half-built campaign would leave a narrator card and lorebook nobody asked for); the runner must keep its
// compare-and-set save and move the story only by the rules. Both are easy to break silently.
import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { buildCampaign } from "./campaign-build";
import { matchLibraryNames } from "./campaign-library";
import { readCampaign } from "./campaign-state";
import { runCampaignReplan, runCampaignTick } from "./campaign-runner";

const BIBLE = {
  focus: "story",
  secondaryFocus: null,
  title: "The Last Lamp",
  pitch: "A keeper is missing.",
  truth: "The keeper staged it.",
  keyTruths: [{ id: "staged", text: "The keeper staged it." }],
  tableRules: "Consequences stick.",
  cast: [
    {
      id: "ivo",
      name: "Ivo",
      role: "son",
      want: "his father",
      fear: "sea",
      secret: "helped",
      towardPlayer: "wary",
      ladder: [],
    },
  ],
  endings: [
    { id: "found", condition: "found", tone: "warm" },
    { id: "gone", condition: "gone", tone: "grim" },
  ],
};

function situation(id: string, clueIds: string[]) {
  return {
    id,
    act: 1,
    title: id,
    happening: `${id} happens`,
    question: `${id}?`,
    present: ["ivo"],
    pressure: ["worse", "worst"],
    clueIds,
    holds: [],
    exits: [
      { id: `${id}-a`, text: "a", consequence: "x", leadsTo: null },
      { id: `${id}-b`, text: "b", consequence: "y", leadsTo: null },
    ],
  };
}

const SITUATIONS = {
  clues: [
    { id: "c1", text: "boots", truthId: "staged" },
    { id: "c2", text: "letter", truthId: "staged" },
    { id: "c3", text: "boat", truthId: "staged" },
  ],
  situations: [situation("arrival", ["c1"]), situation("cellar", ["c2"]), situation("tower", ["c3"])],
};

const CONTENT = {
  narrator: { name: "The Last Lamp", description: "Salt and brass.\n\nWind.", personality: "Ivo: short." },
  lorebook: [{ name: "Lighthouse", keys: ["lighthouse"], content: "Old." }],
  opening: "The lamp is dark.\n\nWind at the door.",
};

/** Answers each campaign call by what its system prompt asks for. */
function fakeLlm(
  extra: Record<string, unknown> = {},
  bibles: unknown[] = [],
): LlmGateway & { calls: string[]; prompts: string[] } {
  const calls: string[] = [];
  const prompts: string[] = [];
  return {
    calls,
    prompts,
    async complete(request) {
      prompts.push(request.messages.map((message) => String(message.content)).join("\n"));
      const system = String(request.messages[0]?.content ?? "");
      const kind = /Step 1 of 3/.test(system)
        ? "bible"
        : /Step 3 of 3/.test(system)
          ? "content"
          : /keep the game master's notes/.test(system)
            ? "tick"
            : /gone somewhere the plan did not expect/.test(system)
              ? "replan"
              : "situations";
      calls.push(kind);
      if (kind === "bible" && bibles.length > 0) return JSON.stringify(bibles.shift());
      const answers: Record<string, unknown> = { bible: BIBLE, situations: SITUATIONS, content: CONTENT, ...extra };
      return JSON.stringify(answers[kind]);
    },
  } as LlmGateway & { calls: string[]; prompts: string[] };
}

function memoryStorage(options: { failMessages?: boolean; serverOrder?: boolean } = {}) {
  const rows: Record<string, Array<Record<string, any>>> = {
    connections: [{ id: "conn", provider: "openai", model: "m", enabled: true, isDefault: true }],
    personas: [],
    characters: [],
    lorebooks: [],
    chats: [],
    prompts: [],
  };
  const entries: Array<Record<string, any>> = [];
  const messages: Array<Record<string, any>> = [];
  let next = 0;
  const storage = {
    async get(entity: string, id: string) {
      return rows[entity]?.find((row) => row.id === id) ?? null;
    },
    async list(entity: string) {
      return rows[entity] ?? [];
    },
    async create(entity: string, value: Record<string, unknown>) {
      const row = { id: `${entity}-${(next += 1)}`, ...value };
      (rows[entity] ??= []).push(row);
      return row;
    },
    async delete(entity: string, id: string) {
      rows[entity] = (rows[entity] ?? []).filter((row) => row.id !== id);
      return { deleted: true };
    },
    async listLorebookEntries(lorebookId: string) {
      return entries.filter((entry) => entry.lorebookId === lorebookId);
    },
    async createLorebookEntries(lorebookId: string, values: Array<Record<string, unknown>>) {
      entries.push(...values.map((value) => ({ ...value, lorebookId })));
      return values;
    },
    async createChatMessage(chatId: string, value: Record<string, unknown>) {
      if (options.failMessages) throw new Error("disk full");
      next += 1;
      const row = {
        id: `m${next}`,
        chatId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, next)).toISOString(),
        ...value,
      };
      messages.push(row);
      return row;
    },
    async listChatMessages(chatId: string, query: { descending?: boolean; limit?: number } = {}) {
      const list = messages.filter((message) => message.chatId === chatId);
      // The real server (apply_message_pagination) returns the newest `limit` rows, oldest first, whatever
      // `descending` says.
      if (options.serverOrder) return query.limit ? list.slice(-query.limit) : list;
      const ordered = query.descending ? [...list].reverse() : list;
      return query.limit ? ordered.slice(0, query.limit) : ordered;
    },
    async bulkDeleteChatMessages() {
      return {};
    },
    async patchChatMetadata(chatId: string, patch: Record<string, unknown>) {
      const chat = rows.chats!.find((row) => row.id === chatId)!;
      chat.metadata = { ...chat.metadata, ...patch };
      return chat;
    },
    async updateChatIfUnchanged(chatId: string, expected: any, patch: any) {
      const chat = rows.chats!.find((row) => row.id === chatId)!;
      const key = Object.keys(expected.metadata)[0]!;
      const same = JSON.stringify(chat.metadata[key]) === JSON.stringify(expected.metadata[key]);
      if (same) chat.metadata = { ...chat.metadata, ...patch.metadata };
      return { updated: same, chat };
    },
    async promptFull() {
      return null;
    },
  } as unknown as StorageGateway;
  return { storage, rows, entries, messages };
}

const INPUT = {
  ask: "a lighthouse mystery",
  focus: null,
  heat: "none" as const,
  limits: [],
  length: "short" as const,
  blind: false,
  connectionId: null,
  personaId: null,
};

describe("building a campaign", () => {
  it("writes the narrator card, lorebook, chat with its hidden plan and the opening", async () => {
    const { storage, rows, entries, messages } = memoryStorage();
    const llm = fakeLlm();
    const built = await buildCampaign({ storage, llm }, INPUT, { now: () => "2026-11-20T00:00:00.000Z" });

    expect(llm.calls).toEqual(["bible", "situations", "situations", "content"]);
    expect(built).toMatchObject({ title: "The Last Lamp", pitch: "A keeper is missing." });
    const chat = rows.chats![0]!;
    expect(chat).toMatchObject({ mode: "roleplay", activeLorebookIds: [rows.lorebooks![0]!.id] });
    const state = readCampaign(chat.metadata);
    expect(state?.status).toBe("playing");
    expect(state?.plan.situations.map((s) => s.id)).toEqual(["arrival", "cellar", "tower"]);
    expect(state?.narratorCharacterId).toBe(rows.characters![0]!.id);
    expect(rows.characters![0]!.data.first_mes).toBe("");
    expect(entries).toHaveLength(1);
    // Paragraph breaks survive.
    expect(messages[0]?.content).toBe("The lamp is dark.\n\nWind at the door.");
  });

  it("removes everything it wrote when a later write fails", async () => {
    const { storage, rows } = memoryStorage({ failMessages: true });
    await expect(buildCampaign({ storage, llm: fakeLlm() }, INPUT)).rejects.toThrow("disk full");
    expect(rows.characters).toEqual([]);
    expect(rows.lorebooks).toEqual([]);
    expect(rows.chats).toEqual([]);
  });

  it("goes in blind without a teaser", async () => {
    const { storage } = memoryStorage();
    const built = await buildCampaign({ storage, llm: fakeLlm() }, { ...INPUT, blind: true });
    expect(built.pitch).toBe("");
  });
});

describe("running a campaign", () => {
  async function playedCampaign(tick: Record<string, unknown>, replan?: Record<string, unknown>) {
    const store = memoryStorage();
    const llm = fakeLlm({ tick, ...(replan ? { replan } : {}) });
    const built = await buildCampaign({ storage: store.storage, llm }, INPUT);
    await store.storage.createChatMessage(built.chatId, { role: "user", content: "I climb the stairs to the lamp." });
    await store.storage.createChatMessage(built.chatId, { role: "assistant", content: "Ivo follows you up." });
    return { ...store, llm, chatId: built.chatId };
  }

  it("reads the new exchange once and moves the story by its exits", async () => {
    const { storage, llm, chatId, rows } = await playedCampaign({
      situation: "resolved",
      exitId: "arrival-a",
      pacing: "hold",
      newFacts: ["Ivo trusts the player a little."],
    });
    const result = await runCampaignTick({ storage, llm }, chatId);
    expect(result.status).toBe("ticked");
    const state = readCampaign(rows.chats![0]!.metadata)!;
    expect(state.progress.at(-1)).toMatchObject({
      situationId: "cellar",
      pacing: "turn",
      facts: ["Ivo trusts the player a little."],
    });
    expect(await runCampaignTick({ storage, llm }, chatId)).toEqual({ status: "skipped", reason: "nothing_new" });
  });

  it("reads the newest exchange and keeps counting when the server lists messages oldest first", async () => {
    const store = memoryStorage({ serverOrder: true });
    const llm = fakeLlm({ tick: { situation: "ongoing", pacing: "hold" } });
    const built = await buildCampaign({ storage: store.storage, llm }, INPUT);
    const exchange = async (n: number) => {
      await store.storage.createChatMessage(built.chatId, {
        role: "user",
        content: `player turn ${n}: I keep looking around the lamp room for anything out of place.`,
      });
      await store.storage.createChatMessage(built.chatId, { role: "assistant", content: `story reply ${n}` });
    };
    // Longer than one 40-message read, with every reply read as it lands.
    for (let n = 1; n <= 30; n += 1) {
      await exchange(n);
      const result = await runCampaignTick({ storage: store.storage, llm }, built.chatId);
      expect(result.status).toBe("ticked");
      expect(llm.prompts.at(-1)).toMatch(new RegExp(`PLAYER: player turn ${n}(?![0-9])`));
      if (n > 1) expect(llm.prompts.at(-1)).not.toMatch(new RegExp(`story reply ${n - 1}(?![0-9])`));
    }
    const state = readCampaign(store.rows.chats![0]!.metadata)!;
    expect(state.progress.at(-1)?.turn).toBe(30);
    expect(await runCampaignTick({ storage: store.storage, llm }, built.chatId)).toEqual({
      status: "skipped",
      reason: "nothing_new",
    });
  });

  it("rewrites only unplayed situations in a replan", async () => {
    const { storage, llm, chatId, rows } = await playedCampaign(
      { situation: "ongoing", pacing: "hold" },
      {
        situations: [situation("arrival", []), situation("harbor", ["c2", "c3"])],
        clues: [],
        endings: BIBLE.endings,
      },
    );
    const next = await runCampaignReplan({ storage, llm }, chatId, "the player wants the harbor");
    expect(next?.plan.situations.map((s) => s.id)).toEqual(["arrival", "harbor"]);
    // The situation in play is kept exactly as it was.
    expect(next?.plan.situations[0]?.clueIds).toEqual(["c1"]);
    expect(readCampaign(rows.chats![0]!.metadata)?.plan.revision).toBe(1);
  });
});

describe("building around the player's own characters and world", () => {
  function withLibrary() {
    const store = memoryStorage();
    store.rows.characters!.push({
      id: "harlequin",
      name: "Harlequin",
      data: { name: "Harlequin", description: "A smiling acrobat in diamonds.", personality: "Playful, cruel." },
    });
    store.rows.lorebooks!.push({ id: "circus", name: "Freak Circus" });
    store.entries.push({ lorebookId: "circus", name: "The Big Top", content: "A striped tent.", enabled: true });
    return store;
  }
  const withHarlequin = { ...BIBLE, cast: [...BIBLE.cast, { ...BIBLE.cast[0], id: "harlequin", name: "Harlequin" }] };

  it("puts the player's characters in the chat instead of a narrator, and attaches their lorebooks", async () => {
    const { storage, rows, messages } = withLibrary();
    const llm = fakeLlm({}, [withHarlequin]);
    await buildCampaign({ storage, llm }, { ...INPUT, characterIds: ["harlequin"], lorebookIds: ["circus"] });

    const chat = rows.chats![0]!;
    expect(chat.characterIds).toEqual(["harlequin"]);
    expect(chat.activeLorebookIds).toHaveLength(2);
    expect(chat.activeLorebookIds).toContain("circus");
    expect(rows.characters!.map((row) => row.id)).toEqual(["harlequin"]);
    expect(messages[0]?.characterId).toBe("harlequin");
    expect(llm.prompts[0]).toContain("A smiling acrobat in diamonds.");
    expect(llm.prompts[0]).toContain("The Big Top: A striped tent.");
  });

  it("asks once more when the cast leaves out the player's character, and stops if it still does", async () => {
    const retried = withLibrary();
    const llm = fakeLlm({}, [BIBLE, withHarlequin]);
    await buildCampaign({ storage: retried.storage, llm }, { ...INPUT, characterIds: ["harlequin"] });
    expect(llm.calls.filter((kind) => kind === "bible")).toHaveLength(2);

    const stubborn = withLibrary();
    await expect(
      buildCampaign(
        { storage: stubborn.storage, llm: fakeLlm({}, [BIBLE, BIBLE]) },
        { ...INPUT, characterIds: ["harlequin"] },
      ),
    ).rejects.toThrow("left Harlequin out");
    expect(stubborn.rows.chats).toEqual([]);
  });

  it("lets the planner read the real limits out of the player's own words", async () => {
    const { storage, rows } = memoryStorage();
    const llm = fakeLlm({}, [{ ...BIBLE, limits: [] }]);
    await buildCampaign({ storage, llm }, { ...INPUT, offTable: "No, go crazy. Don't skimp on the horror." });
    expect(llm.prompts[0]).toContain(`"""No, go crazy. Don't skimp on the horror."""`);
    expect(readCampaign(rows.chats![0]!.metadata)?.request.limits).toEqual([]);
  });
});

describe("finding library picks by name", () => {
  it("matches names loosely, prefers exact names, and reports what it can't find", () => {
    const rows = [
      { id: "1", name: "Harlequin (Pro Dom)" },
      { id: "2", name: "Harlequin" },
      { id: "3", name: "Freak Circus" },
    ];
    expect(matchLibraryNames(rows, ["harlequin", "freak-circus", "Pierrot"])).toEqual({
      ids: ["2", "3"],
      missing: ["Pierrot"],
    });
    expect(matchLibraryNames(rows.slice(0, 1), ["Harlequin"]).ids).toEqual(["1"]);
  });
});
