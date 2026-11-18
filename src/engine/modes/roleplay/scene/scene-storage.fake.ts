// An in-memory storage runtime and scripted model for the scene specs.
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { ChatMessageListOptions, StorageEntity, StorageGateway } from "../../../capabilities/storage";
import type { CanonicalMemoryInput } from "../../../contracts/types/memory";

type JsonRecord = Record<string, unknown>;

export interface FakeSceneStorageSeed {
  chats?: JsonRecord[];
  messages?: Record<string, JsonRecord[]>;
  characters?: JsonRecord[];
  connections?: JsonRecord[];
  personas?: JsonRecord[];
  /** Whether the De-Koi Universal preset is installed. */
  universalPreset?: boolean;
  failArcEnqueue?: boolean;
  failFollowUpWrite?: boolean;
}

export interface FakeSceneStorage {
  storage: StorageGateway;
  chat(id: string): JsonRecord | undefined;
  metadata(id: string): JsonRecord;
  messages(chatId: string): JsonRecord[];
  character(id: string): JsonRecord | undefined;
  createdChats: JsonRecord[];
  deletedChats: string[];
  bulkDeletes: Array<{ chatId: string; messageIds: string[] }>;
  singleDeletes: string[];
  messageReads: Array<{ chatId: string; options?: ChatMessageListOptions }>;
  memories: JsonRecord[];
  jobs: JsonRecord[];
  /** Every storage call in order, as "method:target". */
  calls: string[];
}

const UNIVERSAL_PRESET_VARIABLES = [
  {
    variableName: "contentBoundary",
    options: [
      { id: "boundary_sfw", value: "SFW_BOUNDARY_TEXT" },
      { id: "boundary_mature_dark", value: "MATURE_BOUNDARY_TEXT" },
      { id: "boundary_explicit_adult_safe", value: "ADULT_SAFE_BOUNDARY_TEXT" },
    ],
  },
  {
    variableName: "eroticTone",
    options: [
      { id: "erotic_tone_none", value: "NO_EROTIC_TONE" },
      { id: "erotic_tone_filthy", value: "FILTHY_EROTIC_TONE" },
    ],
  },
  {
    variableName: "narration",
    options: [
      { id: "narration_second", value: "SECOND_PERSON" },
      { id: "narration_third", value: "THIRD_PERSON" },
    ],
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createFakeSceneStorage(seed: FakeSceneStorageSeed = {}): FakeSceneStorage {
  const chats = new Map((seed.chats ?? []).map((chat) => [String(chat.id), clone(chat)]));
  const characters = new Map((seed.characters ?? []).map((row) => [String(row.id), clone(row)]));
  const messageRows: JsonRecord[] = [];
  let clock = Date.parse("2026-11-01T00:00:00.000Z");
  const tick = () => new Date((clock += 1000)).toISOString();
  for (const [chatId, rows] of Object.entries(seed.messages ?? {})) {
    for (const row of rows) messageRows.push({ createdAt: tick(), ...clone(row), chatId });
  }
  let nextId = 0;
  const createdChats: JsonRecord[] = [];
  const deletedChats: string[] = [];
  const bulkDeletes: Array<{ chatId: string; messageIds: string[] }> = [];
  const singleDeletes: string[] = [];
  const messageReads: Array<{ chatId: string; options?: ChatMessageListOptions }> = [];
  const memories: JsonRecord[] = [];
  const jobs: JsonRecord[] = [];
  const snapshots: JsonRecord[] = [];
  const calls: string[] = [];

  const chatMessages = (chatId: string) =>
    messageRows
      .filter((row) => row.chatId === chatId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const storage = {
    async get<T>(entity: StorageEntity, id: string) {
      calls.push(`get:${entity}:${id}`);
      if (entity === "chats") return (chats.has(id) ? clone(chats.get(id)) : null) as T | null;
      if (entity === "characters") return (characters.has(id) ? clone(characters.get(id)) : null) as T | null;
      if (entity === "connections") return ((seed.connections ?? []).find((row) => row.id === id) ?? null) as T;
      if (entity === "personas") return ((seed.personas ?? []).find((row) => row.id === id) ?? null) as T;
      if (entity === "prompts") {
        return (seed.universalPreset !== false && id === "preset_universal_v2" ? { id } : null) as T | null;
      }
      if (entity === "story-consolidation-jobs") return (jobs.find((job) => job.id === id) ?? null) as T | null;
      return null as T | null;
    },
    async list<T>(entity: StorageEntity) {
      if (entity === "connections") return clone(seed.connections ?? []) as T[];
      if (entity === "personas") return clone(seed.personas ?? []) as T[];
      if (entity === "prompt-variables") {
        return (seed.universalPreset === false ? [] : clone(UNIVERSAL_PRESET_VARIABLES)) as T[];
      }
      if (entity === "story-consolidation-jobs") return clone(jobs) as T[];
      if (entity === "game-state-snapshots") return clone(snapshots) as T[];
      return [] as T[];
    },
    async create<T>(entity: StorageEntity, value: JsonRecord) {
      calls.push(`create:${entity}`);
      if (entity === "story-consolidation-jobs") {
        if (seed.failArcEnqueue && value.level === "arc") throw new Error("arc enqueue failed");
        if (seed.failFollowUpWrite && value.followUp === "arc_enqueue") throw new Error("follow-up write failed");
        jobs.push(clone(value));
        return clone(value) as T;
      }
      if (entity === "game-state-snapshots") {
        snapshots.push(clone(value));
        return clone(value) as T;
      }
      const id = `${entity}-${++nextId}`;
      const row = { id, ...clone(value) };
      if (entity === "chats") {
        chats.set(id, row);
        createdChats.push(clone(row));
      }
      return clone(row) as T;
    },
    async update<T>(entity: StorageEntity, id: string, patch: JsonRecord) {
      calls.push(`update:${entity}:${id}`);
      if (entity === "chats") {
        const next = { ...(chats.get(id) ?? { id }), ...clone(patch) };
        chats.set(id, next);
        return clone(next) as T;
      }
      if (entity === "characters") {
        const current = characters.get(id) ?? { id };
        const currentData = (current.data ?? {}) as JsonRecord;
        const patchData = (patch.data ?? {}) as JsonRecord;
        const next = {
          ...current,
          data: {
            ...currentData,
            extensions: {
              ...((currentData.extensions ?? {}) as JsonRecord),
              ...((patchData.extensions ?? {}) as JsonRecord),
            },
          },
        };
        characters.set(id, next);
        return clone(next) as T;
      }
      if (entity === "story-consolidation-jobs") {
        const job = jobs.find((row) => row.id === id);
        if (job) Object.assign(job, clone(patch));
        return clone(job) as T;
      }
      return { id, ...patch } as T;
    },
    async delete(entity: StorageEntity, id: string) {
      calls.push(`delete:${entity}:${id}`);
      if (entity === "chats") {
        chats.delete(id);
        deletedChats.push(id);
      }
      return { deleted: true };
    },
    async listChatMessages<T>(chatId: string, options?: ChatMessageListOptions) {
      messageReads.push({ chatId, options });
      let rows = chatMessages(chatId);
      if (options?.role) rows = rows.filter((row) => row.role === options.role);
      if (options?.descending) rows = rows.reverse();
      if (typeof options?.limit === "number") rows = rows.slice(0, options.limit);
      return clone(rows) as T[];
    },
    async getChatMessage<T>(messageId: string) {
      return (messageRows.find((row) => row.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T>(chatId: string, value: JsonRecord) {
      calls.push(`createChatMessage:${chatId}`);
      const row = { createdAt: tick(), ...clone(value), id: `message-${++nextId}`, chatId };
      messageRows.push(row);
      return clone(row) as T;
    },
    async updateChatMessage<T>(messageId: string, patch: JsonRecord) {
      calls.push(`updateChatMessage:${messageId}`);
      const row = messageRows.find((message) => message.id === messageId);
      if (row) Object.assign(row, clone(patch));
      return clone(row) as T;
    },
    async patchChatMessageExtra<T>(messageId: string, patch: JsonRecord) {
      const row = messageRows.find((message) => message.id === messageId);
      if (row) row.extra = { ...((row.extra ?? {}) as JsonRecord), ...clone(patch) };
      return clone(row) as T;
    },
    async deleteChatMessage(messageId: string) {
      singleDeletes.push(messageId);
      return { deleted: true };
    },
    async bulkDeleteChatMessages(chatId: string, messageIds: string[]) {
      calls.push(`bulkDeleteChatMessages:${chatId}`);
      bulkDeletes.push({ chatId, messageIds: [...messageIds] });
      for (const id of messageIds) {
        const index = messageRows.findIndex((row) => row.id === id);
        if (index >= 0) messageRows.splice(index, 1);
      }
      return { deleted: messageIds.length };
    },
    async patchChatMetadata<T>(chatId: string, patch: JsonRecord) {
      calls.push(`patchChatMetadata:${chatId}`);
      const current = chats.get(chatId) ?? { id: chatId };
      const next = { ...current, metadata: { ...((current.metadata ?? {}) as JsonRecord), ...clone(patch) } };
      chats.set(chatId, next);
      return clone(next) as T;
    },
    async patchChatSummaries<T>(_chatId: string, patch: JsonRecord) {
      return patch as T;
    },
    async addChatMessageSwipe<T>() {
      return {} as T;
    },
    async listChatMemories<T>() {
      return [] as T[];
    },
    async queryMemories() {
      return clone(memories) as never[];
    },
    async createMemory(value: CanonicalMemoryInput) {
      calls.push("createMemory");
      memories.push(clone(value) as unknown as JsonRecord);
      return clone(value) as never;
    },
    async rebuildMemoryIndex() {
      return { rebuilt: 0 } as never;
    },
    async getWorldState<T>() {
      return null as T | null;
    },
    async saveTrackerSnapshot<T>(_chatId: string, snapshot: JsonRecord) {
      return snapshot as T;
    },
    async listLorebookEntries<T>() {
      return [] as T[];
    },
    async createLorebookEntries<T>() {
      return [] as T[];
    },
    async promptFull<T>() {
      return null as T | null;
    },
  } as unknown as StorageGateway;

  return {
    storage,
    chat: (id) => (chats.has(id) ? clone(chats.get(id)) : undefined),
    metadata: (id) => clone((chats.get(id)?.metadata ?? {}) as JsonRecord),
    messages: (chatId) => clone(chatMessages(chatId)),
    character: (id) => (characters.has(id) ? clone(characters.get(id)) : undefined),
    createdChats,
    deletedChats,
    bulkDeletes,
    singleDeletes,
    messageReads,
    memories,
    jobs,
    calls,
  };
}

export interface ScriptedLlm {
  llm: LlmGateway;
  requests: LlmRequest[];
}

function systemOf(request: LlmRequest): string {
  return request.messages.find((message) => message.role === "system")?.content ?? "";
}

function userOf(request: LlmRequest): string {
  return request.messages.find((message) => message.role === "user")?.content ?? "";
}

/** Which scene call a request is, read from its instructions. */
export function sceneCallOf(request: LlmRequest): "plan" | "section" | "whole" | "whole_retry" {
  const system = systemOf(request);
  if (system.includes("plan a roleplay scene")) return "plan";
  if (system.includes("one section of a finished roleplay scene")) return "section";
  return system.includes("This is a second attempt") ? "whole_retry" : "whole";
}

/** A model that answers each request with `answer(request)`; a thrown error fails that call. */
export function scriptedLlm(
  answer: (request: LlmRequest, call: ReturnType<typeof sceneCallOf>) => string,
): ScriptedLlm {
  const requests: LlmRequest[] = [];
  const llm: LlmGateway = {
    async complete(request) {
      requests.push(request);
      return answer(request, sceneCallOf(request));
    },
    async *stream() {},
    async listModels() {
      return [];
    },
  };
  return { llm, requests };
}

export { systemOf, userOf };

/** A three-section-capable answer for the whole-scene call. */
export function wholeSummaryJson(summary: string, sections: Partial<Record<string, string[]>> = {}): string {
  return JSON.stringify({
    summary,
    sections: {
      events: [],
      choices: [],
      relationshipShifts: [],
      promises: [],
      reveals: [],
      unresolvedHooks: [],
      currentState: [],
      ...sections,
    },
  });
}

export const THREE_SENTENCE_SUMMARY =
  "Mara entered the flooded archive with the user beside her. She chose to rescue the ledger instead of the lamp. They left together, promising to read it at dawn.";
