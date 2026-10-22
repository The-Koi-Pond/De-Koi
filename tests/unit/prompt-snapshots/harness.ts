import { vi } from "vitest";
import type { IntegrationGateway } from "../../../src/engine/capabilities/integrations";
import type { LlmGateway, LlmMessage, LlmRequest } from "../../../src/engine/capabilities/llm";
import type {
  ChatMessageListOptions,
  ListChatMemoriesOptions,
  StorageEntity,
  StorageGateway,
  StorageListOptions,
} from "../../../src/engine/capabilities/storage";
import type { CanonicalMemoryQuery, CanonicalMemoryRecord } from "../../../src/engine/contracts/types/memory";
import { dryRunGeneration, type GenerationDryRunInput } from "../../../src/engine/generation/start-generation";

type Row = Record<string, unknown>;

/** Every fixture runs at this instant, so time-of-day and "days since" lines never move. */
export const FIXED_NOW = "2026-03-14T18:30:00.000Z";

export interface SnapshotDb {
  rows: Partial<Record<string, Row[]>>;
  messages: Row[];
  chatMemories?: Row[];
  canonicalMemories?: CanonicalMemoryRecord[];
}

function cast<T>(value: unknown): T {
  return value as T;
}

function listRows(rows: Row[], options?: StorageListOptions): Row[] {
  let result = [...rows];
  if (options?.filters) {
    result = result.filter((row) => Object.entries(options.filters ?? {}).every(([key, value]) => row[key] === value));
  }
  if (options?.whereIn) {
    const values = new Set(options.whereIn.values.map(String));
    result = result.filter((row) => values.has(String(row[options.whereIn!.field] ?? "")));
  }
  if (typeof options?.limit === "number") result = result.slice(-options.limit);
  return result;
}

function readOnly(name: string): never {
  throw new Error(`Prompt snapshot fixtures are read-only, but generation called ${name}.`);
}

/** An in-memory store holding only the fixture's rows. Any write fails the test: a dry run must not write. */
export function snapshotStorage(db: SnapshotDb): StorageGateway {
  const rows = (entity: string) => db.rows[entity] ?? [];
  const lorebookEntries = (ids: string[]) =>
    rows("lorebook-entries").filter((entry) => ids.includes(String(entry.lorebookId)));
  const memoriesFor = (query?: CanonicalMemoryQuery) =>
    (db.canonicalMemories ?? []).filter((memory) => {
      if (query?.scope && (memory.scope.kind !== query.scope.kind || memory.scope.id !== query.scope.id)) return false;
      if (query?.memoryIds && !query.memoryIds.includes(memory.id)) return false;
      if (query?.statuses) return query.statuses.includes(memory.status);
      return query?.includeInactive ? true : memory.status === "active" || memory.status === "pinned";
    });
  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      return cast<T[]>(listRows(rows(entity), options));
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      const source = entity === "messages" ? db.messages : rows(entity);
      return cast<T | null>(source.find((row) => row.id === id) ?? null);
    },
    create: () => readOnly("create"),
    update: () => readOnly("update"),
    delete: () => readOnly("delete"),
    async listChatMessages<T = unknown>(chatId: string, options?: ChatMessageListOptions): Promise<T[]> {
      let messages = db.messages.filter((message) => message.chatId === chatId);
      if (options?.before) {
        const index = messages.findIndex((message) => message.id === options.before);
        if (index >= 0) messages = messages.slice(0, index);
      }
      if (typeof options?.limit === "number") messages = messages.slice(-options.limit);
      return cast<T[]>(messages);
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return cast<T | null>(db.messages.find((message) => message.id === messageId) ?? null);
    },
    createChatMessage: () => readOnly("createChatMessage"),
    updateChatMessage: () => readOnly("updateChatMessage"),
    deleteChatMessage: () => readOnly("deleteChatMessage"),
    patchChatMessageExtra: () => readOnly("patchChatMessageExtra"),
    addChatMessageSwipe: () => readOnly("addChatMessageSwipe"),
    patchChatMetadata: () => readOnly("patchChatMetadata"),
    patchChatSummaries: () => readOnly("patchChatSummaries"),
    async listChatMemories<T = unknown>(chatId: string, options?: ListChatMemoriesOptions): Promise<T[]> {
      const memories = (db.chatMemories ?? []).filter((memory) => memory.chatId === chatId);
      const ordered = [...memories].sort((left, right) =>
        String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
      );
      return cast<T[]>(typeof options?.limit === "number" ? ordered.slice(0, options.limit) : ordered);
    },
    async queryMemories(query?: CanonicalMemoryQuery) {
      return memoriesFor(query);
    },
    async getWorldState() {
      return null;
    },
    saveTrackerSnapshot: () => readOnly("saveTrackerSnapshot"),
    async listLorebookEntries<T = unknown>(lorebookId: string): Promise<T[]> {
      return cast<T[]>(lorebookEntries([lorebookId]));
    },
    async listLorebookEntriesByLorebookIds<T = unknown>(lorebookIds: string[]): Promise<T[]> {
      return cast<T[]>(lorebookEntries(lorebookIds));
    },
    createLorebookEntries: () => readOnly("createLorebookEntries"),
    async promptFull<T = unknown>(presetId: string): Promise<T | null> {
      const preset = rows("prompts").find((row) => row.id === presetId);
      if (!preset) return null;
      const byPreset = (entity: string) => rows(entity).filter((row) => row.presetId === presetId);
      return cast<T>({
        preset,
        sections: byPreset("prompt-sections"),
        groups: byPreset("prompt-groups"),
        choiceBlocks: byPreset("prompt-variables"),
      });
    },
  };
}

const noIntegrations: IntegrationGateway = {
  spotify: {
    playbackAvailable: async () => false,
    player: () => readOnly("spotify.player"),
    playlists: () => readOnly("spotify.playlists"),
    playlistTracks: () => readOnly("spotify.playlistTracks"),
    searchTracks: () => readOnly("spotify.searchTracks"),
    playTrack: () => readOnly("spotify.playTrack"),
    play: () => readOnly("spotify.play"),
    volume: () => readOnly("spotify.volume"),
  },
  customTools: { execute: () => readOnly("customTools.execute") },
  image: { generate: () => readOnly("image.generate") },
};

/** Small seeded generator (mulberry32) so "random" prompt picks are the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pins the clock, random picks and generated ids. Call `vi.useRealTimers()` and `vi.restoreAllMocks()` after. */
export function freezeRuntime(): void {
  vi.useFakeTimers({ now: new Date(FIXED_NOW), toFake: ["Date"] });
  vi.spyOn(Math, "random").mockImplementation(seededRandom(1485));
  let nextId = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    nextId += 1;
    return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
  });
}

/** Runs one dry-run turn against a fake model and returns the first request the engine sent it. */
export async function captureFirstModelRequest(
  storage: StorageGateway,
  input: GenerationDryRunInput,
): Promise<LlmRequest> {
  const requests: LlmRequest[] = [];
  const llm: LlmGateway = {
    async complete() {
      return "";
    },
    async listModels() {
      return [];
    },
    async *stream(request) {
      requests.push(structuredClone(request));
      yield { type: "token", text: "Snapshot reply." };
    },
  };
  for await (const _event of dryRunGeneration({ storage, llm, integrations: noIntegrations }, input)) {
    // Drain the turn; the request is captured inside the fake model.
  }
  const first = requests[0];
  if (!first) throw new Error("The dry run never called the model.");
  return first;
}

const UPDATE_COMMAND = "pnpm test:prompt-snapshots:update";

function messageHeader(message: LlmMessage, index: number, total: number): string {
  const parts = [`[${index + 1}/${total}] ${message.role}`];
  if (message.contextKind) parts.push(`kind=${message.contextKind}`);
  if (message.displayName) parts.push(`name=${message.displayName}`);
  if (message.name) parts.push(`speaker=${message.name}`);
  if (message.images?.length) parts.push(`images=${message.images.length}`);
  return `=== ${parts.join(" | ")} ===`;
}

/** Plain text, one block per message in send order, so a prompt change reads as an ordinary text diff. */
export function renderPromptSnapshot(title: string, request: LlmRequest): string {
  const lines = [
    `# Prompt snapshot: ${title}`,
    `# Update after an intended prompt change: ${UPDATE_COMMAND}`,
    `# ${request.messages.length} messages sent to the model, in order.`,
  ];
  request.messages.forEach((message, index) => {
    lines.push("", messageHeader(message, index, request.messages.length), message.content);
  });
  return `${lines.join("\n")}\n`;
}
