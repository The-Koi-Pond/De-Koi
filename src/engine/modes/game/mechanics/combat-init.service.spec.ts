import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../../../capabilities/storage";
import type { EncounterSettings } from "../../../contracts/types/combat-encounter";
import { initGameCombatEncounter } from "./combat-init.service";

type JsonRecord = Record<string, unknown>;

const settings: EncounterSettings = {
  combatNarrative: { tense: "present", person: "second", narration: "limited", pov: "Player" },
  summaryNarrative: { tense: "past", person: "third", narration: "omniscient", pov: "Narrator" },
  historyDepth: 4,
};

function validCombatJson(overrides: JsonRecord = {}): string {
  return JSON.stringify({
    party: [
      {
        name: "Mira",
        hp: 30,
        maxHp: 30,
        attacks: [{ name: "Blade", type: "single-target", description: "A clean strike." }],
        items: ["Potion"],
        statuses: [],
        isPlayer: true,
      },
    ],
    enemies: [
      {
        name: "Glass Warden",
        hp: 18,
        maxHp: 18,
        attacks: [{ name: "Shard", type: "single-target" }],
        statuses: [],
        description: "A crystalline guard.",
        sprite: "glass-warden",
      },
    ],
    environment: "A mirror-bright hall.",
    styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
    itemEffects: [],
    mechanics: [],
    dialogueCues: [],
    visuals: { isBossFight: false, enemyImagePrompts: [] },
    ...overrides,
  });
}

function llmWithResponses(responses: string[]): LlmGateway & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) throw new Error("No queued LLM response");
      return response;
    }),
    stream: vi.fn(),
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway & { requests: LlmRequest[] };
}

function listRecords(records: JsonRecord[], options?: StorageListOptions): JsonRecord[] {
  if (!options?.filters) return records;
  return records.filter((record) =>
    Object.entries(options.filters ?? {}).every(([key, value]) => record[key] === value),
  );
}

function storageGateway(): StorageGateway {
  const rows: Partial<Record<StorageEntity, JsonRecord[]>> = {
    chats: [{ id: "chat-1", connectionId: "conn-1", metadata: { gameCharacterCards: [{ name: "Mira" }] } }],
    connections: [{ id: "conn-1", provider: "test" }],
    personas: [],
    "lorebook-entries": [],
  };

  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      return listRecords(rows[entity] ?? [], options) as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      return ((rows[entity] ?? []).find((record) => record.id === id) ?? null) as T | null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T = unknown>(_entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      return { id, ...patch } as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>() {
      return [{ role: "assistant", content: "The hall trembles." }] as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(_chatId: string, value: Record<string, unknown>) {
      return value as T;
    },
    async updateChatMessage<T = unknown>(_messageId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async patchChatSummaries<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState<T = unknown>() {
      return {} as T;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Record<string, unknown>) {
      return snapshot as T;
    },
    async listLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async promptFull() {
      return null;
    },
  };
}

describe("initGameCombatEncounter structured generation", () => {
  it("returns sanitized combat state from valid combat JSON", async () => {
    const llm = llmWithResponses([
      validCombatJson({
        party: [{ name: "Mira", hp: 99, maxHp: 30, attacks: [], items: [], statuses: [], isPlayer: true }],
      }),
    ]);

    const result = await initGameCombatEncounter(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", connectionId: null, settings },
    );

    expect(result.combatState.party[0]).toMatchObject({ name: "Mira", hp: 30, maxHp: 30 });
    expect(result.combatState.enemies[0]?.name).toBe("Glass Warden");
  });

  it("accepts a combatState wrapper object", async () => {
    const llm = llmWithResponses([JSON.stringify({ combatState: JSON.parse(validCombatJson()) })]);

    const result = await initGameCombatEncounter(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", connectionId: null, settings },
    );

    expect(result.combatState.environment).toBe("A mirror-bright hall.");
    expect(result.combatState.enemies).toHaveLength(1);
  });
  it("keeps direct combat JSON when passthrough combatState noise is malformed", async () => {
    const llm = llmWithResponses([
      validCombatJson({
        environment: "A direct arena.",
        combatState: { party: [], enemies: [] },
      }),
    ]);

    const result = await initGameCombatEncounter(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", connectionId: null, settings },
    );

    expect(result.combatState.environment).toBe("A direct arena.");
    expect(result.combatState.party[0]?.name).toBe("Mira");
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed initial combat JSON and returns the repaired state", async () => {
    const llm = llmWithResponses(["not json", validCombatJson({ environment: "A repaired arena." })]);

    const result = await initGameCombatEncounter(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", connectionId: null, settings },
    );

    expect(result.combatState.environment).toBe("A repaired arena.");
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("game.combatInit");
  });

  it("rejects malformed combat output instead of returning fallback combat state", async () => {
    const llm = llmWithResponses(["not json", JSON.stringify({ party: [], enemies: [] })]);

    await expect(
      initGameCombatEncounter({ storage: storageGateway(), llm }, { chatId: "chat-1", connectionId: null, settings }),
    ).rejects.toThrow(
      "Combat setup did not return usable structured data. Nothing was changed; try again or choose a different model.",
    );
  });
});
