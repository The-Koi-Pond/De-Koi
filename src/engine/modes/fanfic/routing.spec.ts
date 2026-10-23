import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import { readHelperRuns } from "../../generation/helper-runs";
import type { JsonRecord } from "../../generation/runtime-records";
import { checkFanficChapterContinuity } from "./continuity";
import { fanficChapterTextKey, updateFanficLedger } from "./ledger";
import { isFanficNoConnectionError, pickFanficHelperConnection } from "./llm-json";
import { generateFanficOutline } from "./outline";
import { loadFanficChapterForEdit } from "./passage";
import { createFanficState, defaultFanficRequest } from "./request";

const request = {
  ...defaultFanficRequest(),
  fandom: "The Freak Circus",
  characters: ["Pierrot", "Harlequin"],
  prompt: "Pierrot learns to share.",
  chapterCount: 3,
};

const CONNECTIONS: JsonRecord[] = [
  { id: "writer", name: "Writer", provider: "anthropic", model: "big-model" },
  { id: "cheap", name: "Cheap", provider: "openai", model: "small-model" },
  { id: "ollama", name: "Ollama", provider: "custom", model: "llama", baseUrl: "http://127.0.0.1:11434/v1" },
];

const CHAPTERS = [
  "Pierrot cut his left hand on the knife and bandaged it. Harlequin hid the red ball under the stage.",
  "The next night Pierrot juggled one-handed. Harlequin told him where the red ball was.",
  "On the third day the bandage came off and Pierrot juggled with both hands again.",
];

function fic(options: { routes?: Record<string, string>; localOnly?: string[]; connectionId?: string } = {}) {
  const rows = new Map<string, JsonRecord>();
  const chat: JsonRecord = {
    id: "fic-1",
    mode: "fanfic",
    connectionId: options.connectionId ?? "writer",
    characterIds: [],
    metadata: { fanfic: { ...createFanficState(request), outlineApproved: true } },
  };
  if (options.routes) {
    rows.set("model-routing", {
      id: "model-routing",
      value: { version: 1, routes: options.routes, localOnly: options.localOnly },
    });
  }
  const messages = CHAPTERS.map((content, index) => ({
    id: `m${index + 1}`,
    role: "assistant",
    content,
    swipes: [content],
  }));
  const storage = {
    async get(entity: StorageEntity, id: string) {
      if (entity === "chats") return id === "fic-1" ? chat : null;
      if (entity === "connections") return CONNECTIONS.find((connection) => connection.id === id) ?? null;
      if (entity === "app-settings") return rows.get(id) ?? null;
      return null;
    },
    async list(entity: StorageEntity) {
      return entity === "connections" ? CONNECTIONS : [];
    },
    async create(entity: StorageEntity, value: JsonRecord) {
      if (entity === "app-settings") rows.set(String(value.id), value);
      return value;
    },
    async update(entity: StorageEntity, id: string, patch: JsonRecord) {
      if (entity === "app-settings") rows.set(id, { ...rows.get(id), ...patch });
      return rows.get(id);
    },
    async listChatMessages() {
      return messages;
    },
    async patchChatMetadata(_chatId: string, patch: JsonRecord) {
      chat.metadata = { ...(chat.metadata as JsonRecord), ...patch };
      return chat;
    },
    async updateChatIfUnchanged(_chatId: string, _expected: unknown, patch: { metadata: JsonRecord }) {
      chat.metadata = { ...(chat.metadata as JsonRecord), ...patch.metadata };
      return { updated: true, chat };
    },
  } as unknown as StorageGateway;
  return { storage, chat };
}

/** Answers outline, ledger, and continuity requests, and records which connection each went to. */
function helperLlm() {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (call: LlmRequest) => {
      requests.push(call);
      const system = call.messages[0]?.content ?? "";
      const user = call.messages.at(-1)?.content ?? "";
      const ledgerChapters = [...user.matchAll(/^## Chapter (\d+)$/gm)].map((match) => Number(match[1]));
      if (ledgerChapters.length > 0 && !system.includes("continuity")) {
        return JSON.stringify({
          entries: ledgerChapters.map((chapter) => ({
            chapter,
            summary: `Chapter ${chapter} happens.`,
            timeline: `Day ${chapter}`,
            knowledge: [],
            conditions: [],
            relationships: [],
            openThreads: [],
          })),
        });
      }
      if (/outline|plan/i.test(system) && !/continuity/i.test(system)) {
        return JSON.stringify({
          title: "Sharing",
          summary: "Pierrot learns to share.",
          chapters: [1, 2, 3].map((number) => ({ number, title: `Part ${number}`, summary: `Beat ${number}.` })),
        });
      }
      return JSON.stringify({ issues: [] });
    }),
  } as unknown as LlmGateway;
  return { llm, requests, connections: () => requests.map((call) => call.connectionId) };
}

const PICK = {
  chatId: "fic-1",
  job: "story ledger",
  missing: "Pick a connection for the story ledger.",
  gone: "That connection no longer exists.",
};

describe("pickFanficHelperConnection", () => {
  it("uses the fic's connection when the helper has no route, and says so", async () => {
    const { storage, chat } = fic();
    await expect(pickFanficHelperConnection(storage, "fanficChecks", chat, PICK)).resolves.toMatchObject({
      connectionId: "writer",
      rule: "chat",
    });
    const [run] = (await readHelperRuns(storage)).fanficChecks ?? [];
    expect(run).toMatchObject({ job: "story ledger", chatId: "fic-1", connectionName: "Writer", model: "big-model" });
  });

  it("uses the helper's route over the fic's connection", async () => {
    const { storage, chat } = fic({ routes: { fanficChecks: "cheap" } });
    await expect(pickFanficHelperConnection(storage, "fanficChecks", chat, PICK)).resolves.toMatchObject({
      connectionId: "cheap",
      rule: "route",
    });
    // The other fanfic helper keeps the fic's connection.
    await expect(
      pickFanficHelperConnection(storage, "fanficPlanning", chat, { ...PICK, job: "outline" }),
    ).resolves.toMatchObject({
      connectionId: "writer",
      rule: "chat",
    });
  });

  it("lets a connection named for the run outrank the route, but not leave the device", async () => {
    const { storage, chat } = fic({ routes: { fanficChecks: "ollama" }, localOnly: ["fanficChecks"] });
    await expect(
      pickFanficHelperConnection(storage, "fanficChecks", chat, { ...PICK, connectionId: "ollama" }),
    ).resolves.toMatchObject({ connectionId: "ollama", rule: "picked" });
    await expect(
      pickFanficHelperConnection(storage, "fanficChecks", chat, { ...PICK, connectionId: "cheap" }),
    ).rejects.toMatchObject({ code: "route_unavailable", problem: "not_local" });
    const [run] = (await readHelperRuns(storage)).fanficChecks ?? [];
    expect(run).toMatchObject({ connectionId: "cheap", rule: "picked" });
    expect(run?.problem).toContain('"Cheap" sends work off it');
  });

  it("never falls back to the fic's connection when the route is broken", async () => {
    const { storage, chat } = fic({ routes: { fanficChecks: "deleted" } });
    await expect(pickFanficHelperConnection(storage, "fanficChecks", chat, PICK)).rejects.toMatchObject({
      code: "route_unavailable",
    });
    expect((await readHelperRuns(storage)).fanficChecks?.[0]?.problem).toContain("no longer exists");
  });

  it("marks a fic with no connection, and takes the random pool only where allowed", async () => {
    const { storage, chat } = fic({ connectionId: "" });
    const error = await pickFanficHelperConnection(storage, "fanficChecks", chat, PICK).catch((caught) => caught);
    expect(error.message).toBe("Pick a connection for the story ledger.");
    expect(isFanficNoConnectionError(error)).toBe(true);

    const random = fic({ connectionId: "random" });
    await expect(pickFanficHelperConnection(random.storage, "fanficChecks", random.chat, PICK)).rejects.toThrow(
      "Pick a connection for the story ledger.",
    );
    await expect(
      pickFanficHelperConnection(random.storage, "fanficPlanning", random.chat, { ...PICK, allowRandom: true }),
    ).resolves.toEqual({ connectionId: "random", connection: null, rule: "chat" });
  });
});

describe("fanfic helpers on their routes", () => {
  it("plans the outline on the Fanfic planning route", async () => {
    const { storage } = fic({ routes: { fanficPlanning: "cheap", fanficChecks: "ollama" } });
    const { llm, connections } = helperLlm();
    await generateFanficOutline({ storage, llm }, { chatId: "fic-1" });
    expect(connections()).toEqual(["cheap"]);
    expect((await readHelperRuns(storage)).fanficPlanning?.[0]).toMatchObject({ job: "outline", rule: "route" });
  });

  it("builds the story ledger on the Fanfic checks route", async () => {
    const { storage } = fic({ routes: { fanficChecks: "cheap" } });
    const { llm, connections } = helperLlm();
    const ledger = await updateFanficLedger({ storage, llm }, { chatId: "fic-1" });
    expect(ledger.entries.map((entry) => entry.textKey)).toEqual(CHAPTERS.map(fanficChapterTextKey));
    expect(new Set(connections())).toEqual(new Set(["cheap"]));
    expect((await readHelperRuns(storage)).fanficChecks?.[0]).toMatchObject({ job: "story ledger", rule: "route" });
  });

  it("stops the quiet after-chapter ledger update on a broken route, instead of skipping it", async () => {
    const { storage } = fic({ routes: { fanficChecks: "deleted" } });
    const { llm } = helperLlm();
    await expect(updateFanficLedger({ storage, llm }, { chatId: "fic-1", onlyIfInUse: true })).rejects.toMatchObject({
      code: "route_unavailable",
    });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("still skips the quiet ledger update for a fic with no connection, and notes nothing", async () => {
    const { storage } = fic({ connectionId: "" });
    const { llm } = helperLlm();
    await expect(updateFanficLedger({ storage, llm }, { chatId: "fic-1", onlyIfInUse: true })).resolves.toMatchObject({
      entries: [],
    });
    expect(await readHelperRuns(storage)).toEqual({});
  });

  it("doesn't note a quiet ledger update that had nothing to do", async () => {
    const { storage } = fic({ routes: { fanficChecks: "cheap" } });
    const { llm } = helperLlm();
    // Three short chapters fit the window, so the quiet update leaves the ledger off.
    await updateFanficLedger({ storage, llm }, { chatId: "fic-1", onlyIfInUse: true });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(await readHelperRuns(storage)).toEqual({});
  });

  it("checks continuity on the Fanfic checks route and notes the check", async () => {
    const { storage } = fic({ routes: { fanficChecks: "cheap" } });
    const { llm, connections } = helperLlm();
    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "fic-1", messageId: "m3" });
    expect(check.issues).toEqual([]);
    expect(new Set(connections())).toEqual(new Set(["cheap"]));
    expect((await readHelperRuns(storage)).fanficChecks?.[0]).toMatchObject({ job: "continuity check", rule: "route" });
  });

  it("keeps the writer (scene rewrites, passage edits) on the fic's connection whatever the routes say", async () => {
    const { storage } = fic({ routes: { fanficPlanning: "cheap", fanficChecks: "cheap" } });
    const target = await loadFanficChapterForEdit(storage, {
      chatId: "fic-1",
      messageId: "m2",
      textKey: fanficChapterTextKey(CHAPTERS[1]!),
    });
    expect(target.connectionId).toBe("writer");
  });
});
