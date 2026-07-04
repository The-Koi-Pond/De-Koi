import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type {
  ChatMessageListOptions,
  StorageEntity,
  StorageGateway,
  StorageListOptions,
} from "../../../capabilities/storage";
import type {
  CombatInitState,
  EncounterActionRequest,
  EncounterSettings,
} from "../../../contracts/types/combat-encounter";
import { initRoleplayEncounter, resolveRoleplayEncounterAction } from "./encounter-service";

type JsonRecord = Record<string, unknown>;

const settings: EncounterSettings = {
  combatNarrative: { tense: "present", person: "second", narration: "limited", pov: "Player" },
  summaryNarrative: { tense: "past", person: "third", narration: "omniscient", pov: "Narrator" },
  historyDepth: 5,
};

function validCombatJson(overrides: JsonRecord = {}): string {
  return JSON.stringify({
    party: [
      {
        name: "Mira",
        hp: 30,
        maxHp: 30,
        attacks: [{ name: "Blade", type: "single-target", description: "A clean strike." }],
        items: [],
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
    chats: [{ id: "chat-1", connectionId: "conn-1", characterIds: [], metadata: {} }],
    connections: [{ id: "conn-1", provider: "test" }],
    personas: [{ id: "persona-1", name: "Mira", isActive: true }],
    characters: [],
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
    async listChatMessages<T = unknown>(_chatId: string, _options?: ChatMessageListOptions) {
      return [
        { role: "user", content: "The door opens." },
        { role: "assistant", content: "The hall trembles." },
      ] as T[];
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

describe("roleplay encounter recent history", () => {
  it("bounds initial encounter chat history reads to the requested depth", async () => {
    const storage = storageGateway();
    const listChatMessages = vi.spyOn(storage, "listChatMessages");
    const llm = llmWithResponses([validCombatJson()]);

    await initRoleplayEncounter({ storage, llm }, { chatId: "chat-1", connectionId: null, settings });

    expect(listChatMessages).toHaveBeenCalledWith("chat-1", expect.objectContaining({ limit: settings.historyDepth }));
  });

  it("bounds action chat history reads to the requested depth", async () => {
    const storage = storageGateway();
    const listChatMessages = vi.spyOn(storage, "listChatMessages");
    const llm = llmWithResponses([
      JSON.stringify({
        combatStats: {
          party: [{ name: "Mira", hp: 30, maxHp: 30, attacks: [], items: [], statuses: [], isPlayer: true }],
          enemies: [],
          environment: "A mirror-bright hall.",
        },
        playerActions: { attacks: [], items: [] },
        enemyActions: [],
        partyActions: [],
        narrative: "Mira advances.",
      }),
    ]);
    const combatStats = JSON.parse(validCombatJson()) as CombatInitState;
    const input: EncounterActionRequest = {
      chatId: "chat-1",
      connectionId: null,
      action: "Strike",
      combatStats,
      playerActions: { attacks: [], items: [] },
      encounterLog: [],
      settings,
    };

    await resolveRoleplayEncounterAction({ storage, llm }, input);

    expect(listChatMessages).toHaveBeenCalledWith("chat-1", expect.objectContaining({ limit: settings.historyDepth }));
  });
});
