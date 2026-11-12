import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { AgentDebugEntry } from "../../../contracts/types/agent";
import {
  ENCOUNTER_SETUP_INVALID_MESSAGE,
  ENCOUNTER_TURN_INVALID_MESSAGE,
  resolveEncounterTurn,
  startEncounterFight,
  writeEncounterSummary,
} from "./encounter-calls";
import type { EncounterFight, EncounterSettings } from "./encounter-types";

const narration = { tense: "present", person: "third", narration: "omniscient", pov: "narrator" } as const;

const settings: EncounterSettings = {
  combatNarration: narration,
  summaryNarration: { ...narration, tense: "past" },
  spellbookId: null,
  historyDepth: 3,
};

const fight: EncounterFight = {
  party: [{ name: "Mira", hp: 30, maxHp: 30, attacks: [], items: [], statuses: [], isPlayer: true }],
  enemies: [{ name: "Warden", hp: 18, maxHp: 18, attacks: [], statuses: [], description: "", sprite: "🗿" }],
  environment: "A hall.",
  styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
  playerActions: { attacks: [], items: [] },
};

const setupJson = JSON.stringify({
  party: [{ name: "Mira", hp: 30, maxHp: 30, isPlayer: true }],
  enemies: [{ name: "Warden", hp: 18, maxHp: 18, sprite: "🗿" }],
  environment: "A mirror-bright hall.",
});

function fakeStorage(options: { connections?: Array<Record<string, unknown>> } = {}) {
  const connections = options.connections ?? [{ id: "conn-1", isDefault: true }];
  const storage = {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats") return { id, characterIds: [], metadata: {} };
      if (entity === "connections") return connections.find((connection) => connection.id === id) ?? null;
      return null;
    }),
    list: vi.fn(async (entity: string) => {
      if (entity === "connections") return connections;
      if (entity === "personas") return [{ id: "persona-1", name: "Mira", isActive: true }];
      return [];
    }),
    listChatMessages: vi.fn(async () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 ? "assistant" : "user",
        content: `Line ${index}`,
        createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
      })),
    ),
    getWorldState: vi.fn(async () => null),
    listLorebookEntries: vi.fn(async () => []),
    createChatMessage: vi.fn(async (_chatId: string, value: Record<string, unknown>) => ({ id: "new", ...value })),
  };
  return { storage, gateway: storage as unknown as StorageGateway };
}

function fakeLlm(responses: Array<string | Error>) {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (request: LlmRequest) => {
    requests.push(request);
    const next = responses.shift();
    if (next === undefined || next instanceof Error) throw next ?? new Error("No queued response");
    return next;
  });
  return { requests, complete, gateway: { complete } as unknown as LlmGateway };
}

function signal() {
  return new AbortController().signal;
}

describe("encounter model calls", () => {
  it("starts a fight on the chat's connection with the setup parameters and bounded history", async () => {
    const { storage, gateway } = fakeStorage();
    const llm = fakeLlm([setupJson]);

    const started = await startEncounterFight(
      { storage: gateway, llm: llm.gateway },
      { chatId: "chat-1", settings, signal: signal() },
    );

    expect(started.enemies[0]).toMatchObject({ name: "Warden", hp: 18 });
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.requests[0]).toMatchObject({
      connectionId: "conn-1",
      parameters: { temperature: 0.8, maxTokens: 12_000 },
    });
    expect(storage.listChatMessages).toHaveBeenCalledWith("chat-1", expect.objectContaining({ limit: 3 }));
    const history = llm.requests[0]!.messages.filter((message) => message.content.startsWith("Line "));
    expect(history.map((message) => message.content)).toEqual(["Line 7", "Line 8", "Line 9"]);
  });

  it("fails on unparseable setup output instead of starting a made-up fight", async () => {
    const { gateway } = fakeStorage();
    const llm = fakeLlm(["The goblins attack! (no JSON here)"]);

    await expect(
      startEncounterFight({ storage: gateway, llm: llm.gateway }, { chatId: "chat-1", settings, signal: signal() }),
    ).rejects.toThrow(ENCOUNTER_SETUP_INVALID_MESSAGE);
  });

  it("names a missing connection instead of the generic setup error", async () => {
    const { gateway } = fakeStorage({ connections: [] });
    const llm = fakeLlm([setupJson]);

    await expect(
      startEncounterFight({ storage: gateway, llm: llm.gateway }, { chatId: "chat-1", settings, signal: signal() }),
    ).rejects.toThrow("This chat has no model connection");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("sends the three setup debug entries in order while debug mode is on", async () => {
    const { gateway } = fakeStorage();
    const entries: Array<Omit<AgentDebugEntry, "timestamp">> = [];

    await startEncounterFight(
      { storage: gateway, llm: fakeLlm([setupJson]).gateway },
      { chatId: "chat-1", settings, signal: signal(), debugSink: (entry) => entries.push(entry) },
    );

    expect(entries.map((entry) => entry.message)).toEqual([
      "[debug/roleplay/encounter:init] request",
      "[debug/roleplay/encounter:init] raw response",
      "[debug/roleplay/encounter:init] parsed response",
    ]);
    expect(entries.every((entry) => entry.level === "debug" && entry.phase === "roleplay-encounter-init")).toBe(true);
  });

  it("resolves a turn with the turn parameters and bounded history", async () => {
    const { storage, gateway } = fakeStorage();
    const llm = fakeLlm([JSON.stringify({ narrative: "Mira presses in." })]);

    const outcome = await resolveEncounterTurn(
      { storage: gateway, llm: llm.gateway },
      { chatId: "chat-1", settings, fight, rounds: [], action: "Uses Blade on Warden!", signal: signal() },
    );

    expect(outcome.log).toEqual([{ kind: "narration", text: "Mira presses in." }]);
    expect(llm.requests[0]).toMatchObject({
      connectionId: "conn-1",
      parameters: { temperature: 0.8, maxTokens: 8_192 },
    });
    expect(storage.listChatMessages).toHaveBeenCalledWith("chat-1", expect.objectContaining({ limit: 3 }));
  });

  it("reports a junk turn as invalid", async () => {
    const { gateway } = fakeStorage();

    await expect(
      resolveEncounterTurn(
        { storage: gateway, llm: fakeLlm(["I attack the warden"]).gateway },
        { chatId: "chat-1", settings, fight, rounds: [], action: "Strike", signal: signal() },
      ),
    ).rejects.toThrow(ENCOUNTER_TURN_INVALID_MESSAGE);
  });

  it("writes exactly one cleaned assistant message for a summary", async () => {
    const { storage, gateway } = fakeStorage();
    const llm = fakeLlm(["<thinking>plan</thinking>\nThe warden fell at last. [FIGHT CONCLUDED]"]);

    await writeEncounterSummary(
      { storage: gateway, llm: llm.gateway },
      { chatId: "chat-1", settings, result: "victory", rounds: [], signal: signal() },
    );

    expect(llm.requests[0]).toMatchObject({ parameters: { temperature: 0.9, maxTokens: 8_192 } });
    expect(storage.listChatMessages).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledTimes(1);
    expect(storage.createChatMessage).toHaveBeenCalledWith("chat-1", {
      role: "assistant",
      characterId: null,
      content: "The warden fell at last.",
    });
  });

  it.each([
    ["provider failed", new Error("provider failed")],
    ["empty summary", "<thinking>only</thinking>"],
  ])("writes nothing when the summary fails (%s)", async (_label, response) => {
    const { storage, gateway } = fakeStorage();

    await expect(
      writeEncounterSummary(
        { storage: gateway, llm: fakeLlm([response]).gateway },
        { chatId: "chat-1", settings, result: "victory", rounds: [], signal: signal() },
      ),
    ).rejects.toThrow();
    expect(storage.createChatMessage).not.toHaveBeenCalled();
  });

  it("writes nothing when the summary is cancelled while the model answers", async () => {
    const { storage, gateway } = fakeStorage();
    const controller = new AbortController();
    const llm = {
      complete: vi.fn(async () => {
        controller.abort();
        return "The warden fell.";
      }),
    } as unknown as LlmGateway;

    await expect(
      writeEncounterSummary(
        { storage: gateway, llm },
        { chatId: "chat-1", settings, result: "victory", rounds: [], signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(storage.createChatMessage).not.toHaveBeenCalled();
  });
});
