import { describe, expect, it, vi } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryRecord } from "../contracts/types/memory";
import { assembleGenerationPrompt } from "./prompt-assembly";
import { buildCanonicalMemoryContext } from "./canonical-memory-context";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function memory(overrides: Partial<CanonicalMemoryRecord> & { id: string; content: string }): CanonicalMemoryRecord {
  return {
    kind: "fact",
    status: "active",
    scope: { kind: "chat", id: "chat-1" },
    confidence: 0.8,
    provenance: {
      sourceChatId: "chat-1",
      messageIds: ["message-old"],
      sceneId: null,
      characterId: null,
      timestamp: "2026-07-01T10:00:00.000Z",
    },
    title: null,
    tags: [],
    supersedesMemoryId: null,
    supersededByMemoryId: null,
    payload: {},
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function storageWithMemories(args: {
  indexed?: CanonicalMemoryRecord[];
  fallback?: CanonicalMemoryRecord[];
}): StorageGateway {
  return {
    async list<T = unknown>() {
      return asStorageValue<T[]>([]);
    },
    async get() {
      return null;
    },
    async create<T = unknown>() {
      return asStorageValue<T>({});
    },
    async update<T = unknown>() {
      return asStorageValue<T>({});
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages() {
      return [];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>() {
      return asStorageValue<T>({});
    },
    async updateChatMessage<T = unknown>() {
      return asStorageValue<T>({});
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return asStorageValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listLorebookEntries() {
      return [];
    },
    async listLorebookEntriesByLorebookIds() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
    queryMemoryIndex: vi.fn(async () => args.indexed ?? []),
    queryMemories: vi.fn(async () => args.fallback ?? []),
  } as StorageGateway;
}

function promptStorage(memories: CanonicalMemoryRecord[]): StorageGateway {
  const base = storageWithMemories({ indexed: memories });
  return {
    ...base,
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (["personas", "regex-scripts", "lorebooks", "agents", "prompts"].includes(entity)) return [];
      return asStorageValue<T[]>([]);
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === "char-1") {
        return asStorageValue<T>({ id: "char-1", name: "Mira", description: "Mira core.", tags: [] });
      }
      return null;
    },
  } as StorageGateway;
}

describe("canonical memory context", () => {
  it("returns null by default so existing prompt behavior is preserved", async () => {
    const result = await buildCanonicalMemoryContext(storageWithMemories({ indexed: [] }), {
      chat: { id: "chat-1", mode: "conversation", metadata: {} },
      storedMessages: [{ id: "message-new", role: "user", content: "What about the brass key?" }],
      latestUserInput: "What about the brass key?",
      characters: [],
      maxContext: 4096,
    });

    expect(result).toBeNull();
  });

  it("injects indexed canonical memories with debug metadata and separated sections", async () => {
    const storage = storageWithMemories({
      indexed: [
        memory({
          id: "memory-fact",
          kind: "fact",
          content: "Mira keeps the brass key under the blue teacup.",
          tags: ["brass-key"],
          confidence: 0.93,
          payload: { importance: 0.8 },
        }),
        memory({
          id: "memory-relationship",
          kind: "relationship_state",
          content: "Mira trusts the user after the lantern promise.",
          confidence: 0.88,
        }),
        memory({
          id: "memory-scene",
          kind: "scene_event",
          scope: { kind: "scene", id: "scene-1" },
          content: "The cafe scene paused with rain against the windows.",
          confidence: 0.82,
          provenance: {
            sourceChatId: "chat-1",
            messageIds: ["message-scene"],
            sceneId: "scene-1",
            characterId: "char-1",
            timestamp: "2026-07-01T11:00:00.000Z",
          },
        }),
      ],
    });

    const result = await buildCanonicalMemoryContext(storage, {
      chat: { id: "chat-1", mode: "roleplay", characterIds: ["char-1"], metadata: { enableCanonicalMemoryRecall: true, sceneStatus: "active" } },
      storedMessages: [{ id: "message-new", role: "user", content: "Where is the brass key now?" }],
      latestUserInput: "Where is the brass key now?",
      characters: [{ id: "char-1", name: "Mira", description: "Mira core.", tags: [] }],
      maxContext: 4096,
    });

    expect(result?.block).toContain("<canonical_memories>");
    expect(result?.block).toContain("<durable_facts>");
    expect(result?.block).toContain("<relationship_state>");
    expect(result?.block).toContain("<scene_continuity>");
    expect(result?.block).toContain("Mira keeps the brass key");
    expect(result?.attributionItems[0]).toMatchObject({
      sourceId: "memory-fact",
      sourceCollection: "canonical-memories",
      metadata: expect.objectContaining({
        source: "canonical_memory",
        indexSource: "index",
        memoryKind: "fact",
        reasons: expect.arrayContaining(["keyword_match"]),
      }),
    });
    expect(storage.queryMemoryIndex).toHaveBeenCalled();
  });

  it("falls back to lexical canonical queries when index retrieval is unavailable", async () => {
    const storage = storageWithMemories({
      indexed: [],
      fallback: [
        memory({ id: "memory-unrelated", content: "Sunny picnic plans continue at noon." }),
        memory({ id: "memory-fallback", content: "The obsidian compass points toward the archive." }),
      ],
    });

    const result = await buildCanonicalMemoryContext(storage, {
      chat: { id: "chat-1", mode: "conversation", metadata: { enableCanonicalMemoryRecall: true } },
      storedMessages: [{ id: "message-new", role: "user", content: "Can you recall the obsidian compass?" }],
      latestUserInput: "Can you recall the obsidian compass?",
      characters: [],
      maxContext: 4096,
    });

    expect(result?.block).toContain("obsidian compass");
    expect(result?.block).not.toContain("Sunny picnic");
    expect(result?.attributionItems[0]?.metadata).toMatchObject({ indexSource: "lexical" });
  });

  it("filters stale index hits, superseded memories, deleted memories, and newest-message provenance", async () => {
    const result = await buildCanonicalMemoryContext(
      storageWithMemories({
        indexed: [
          memory({ id: "memory-deleted", status: "deleted", content: "Deleted brass key memory." }),
          memory({ id: "memory-superseded", status: "superseded", content: "Old brass key location." }),
          memory({
            id: "memory-newest",
            content: "The newest turn says the key is in hand.",
            provenance: {
              sourceChatId: "chat-1",
              messageIds: ["message-new"],
              sceneId: null,
              characterId: null,
              timestamp: "2026-07-02T10:00:00.000Z",
            },
          }),
          memory({
            id: "memory-active",
            content: "The active replacement says the brass key is under the teacup.",
            supersedesMemoryId: "memory-superseded",
          }),
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          metadata: { enableCanonicalMemoryRecall: true, memoryRecallReadBehindMessages: 1 },
        },
        storedMessages: [{ id: "message-new", role: "user", content: "Where is the brass key?" }],
        latestUserInput: "Where is the brass key?",
        characters: [],
        maxContext: 4096,
      },
    );

    expect(result?.block).toContain("active replacement");
    expect(result?.block).not.toContain("Deleted brass");
    expect(result?.block).not.toContain("Old brass");
    expect(result?.block).not.toContain("newest turn");
  });

  it("packs canonical memories inside the configured token budget", async () => {
    const longMemories = Array.from({ length: 8 }, (_, index) =>
      memory({
        id: `memory-${index}`,
        content: `The brass key detail ${index} ${"continues ".repeat(80)}`,
        confidence: 0.9,
      }),
    );

    const result = await buildCanonicalMemoryContext(storageWithMemories({ indexed: longMemories }), {
      chat: {
        id: "chat-1",
        mode: "conversation",
        metadata: { enableCanonicalMemoryRecall: true, canonicalMemoryRecallTokenBudget: 80 },
      },
      storedMessages: [{ id: "message-new", role: "user", content: "brass key" }],
      latestUserInput: "brass key",
      characters: [],
      maxContext: 4096,
    });

    expect(result?.estimatedTokens).toBeLessThanOrEqual(80);
    expect(result?.attributionItems.length).toBeGreaterThan(0);
    expect(result?.attributionItems.length).toBeLessThan(longMemories.length);
  });

  it("does not inject anything when enabled but no canonical memories match", async () => {
    const result = await buildCanonicalMemoryContext(storageWithMemories({ indexed: [] }), {
      chat: { id: "chat-1", mode: "conversation", metadata: { enableCanonicalMemoryRecall: true } },
      storedMessages: [{ id: "message-new", role: "user", content: "hello" }],
      latestUserInput: "hello",
      characters: [],
      maxContext: 4096,
    });

    expect(result).toBeNull();
  });
});

describe("prompt assembly canonical memory integration", () => {
  it("injects canonical memories separately from transcript recall when enabled", async () => {
    const result = await assembleGenerationPrompt(
      promptStorage([memory({ id: "memory-fact", content: "Mira keeps the brass key under the blue teacup." })]),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: { enableCanonicalMemoryRecall: true, enableMemoryRecall: false },
        },
        storedMessages: [{ id: "message-new", role: "user", content: "Where is the brass key?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Where is the brass key?",
      },
    );

    const promptText = result.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("<canonical_memories>");
    expect(promptText).toContain("Mira keeps the brass key");
    expect(promptText).not.toContain("recalled fragments from earlier in this chat");
    expect(result.contextAttributionItems).toContainEqual(
      expect.objectContaining({
        sourceId: "memory-fact",
        sourceCollection: "canonical-memories",
      }),
    );
  });
});
