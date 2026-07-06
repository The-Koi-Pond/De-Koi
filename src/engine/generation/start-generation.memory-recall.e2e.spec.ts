import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { RefreshChatMemoriesOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  extra?: Record<string, unknown>;
  createdAt: string;
};

type StoredChat = {
  id: string;
  mode: string;
  connectionId: string;
  characterIds: string[];
  metadata: Record<string, unknown>;
  memories: Array<Record<string, unknown>>;
};

function tokenVector(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    normalized.includes("key") || normalized.includes("hid") || normalized.includes("hide") ? 1 : 0,
    normalized.includes("lantern") || normalized.includes("blue") ? 1 : 0,
    normalized.includes("tea") ? 1 : 0,
  ];
}

function memoryRecallStorage() {
  const chat: StoredChat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "conn-1",
    characterIds: ["char-1"],
    metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 1 },
    memories: [],
  };
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": chat,
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
    "char-1": { id: "char-1", name: "Mira", data: { name: "Mira", personality: "attentive" } },
  };
  const messages: StoredMessage[] = [];
  const memoryCaptureJobs = new Map<string, Record<string, unknown>>();
  let nextMessageId = 1;
  let refreshCount = 0;
  const refreshCalls: Array<{ chatId: string; options?: RefreshChatMemoriesOptions }> = [];

  function seedLegacyImportedChat(): void {
    chat.memories = [
      {
        id: "legacy-imported-tea",
        chatId: chat.id,
        content: "Imported old memory: Mira keeps jasmine tea for the user after patrols.",
        sourceChatId: "old-chat",
        messageCount: 1,
        firstMessageAt: "2025-12-31T00:00:00.000Z",
        lastMessageAt: "2025-12-31T00:00:00.000Z",
        createdAt: "2025-12-31T00:00:00.000Z",
        hasEmbedding: false,
        embeddingStatus: "pending",
        embedding: [0.01],
      },
    ];
    for (const content of [
      "The patrol ended near the archive gate.",
      "Mira checked the lanterns before dawn.",
      "Sable left the bridge early.",
      "The user asked Mira to remember small comforts.",
    ]) {
      messages.push({
        id: `legacy-message-${messages.length + 1}`,
        chatId: chat.id,
        role: messages.length % 2 === 0 ? "user" : "assistant",
        content,
        extra: {},
        createdAt: new Date(Date.UTC(2025, 11, messages.length + 1)).toISOString(),
      });
    }
  }

  function migrateLegacyImportedChat(): void {
    chat.memories = chat.memories.map((memory) => ({
      ...memory,
      canonicalMemoryVersion: 1,
      memoryKind: "imported",
      scopeType: "chat",
      scopeId: chat.id,
      status: "active",
      legacySourceLane: "memory_recall_import",
      legacySourceId: memory.id,
      creationReason: "Migrated imported memory recall row",
      migratedAt: "2026-01-01T00:00:00.000Z",
      hasEmbedding: true,
      embeddingStatus: "vectorized",
      embeddingSource: "lexical",
      embedding: tokenVector(String(memory.content ?? "")),
    }));
    chat.metadata = {
      ...chat.metadata,
      memoryMigration: { version: 1, strategy: "additive_canonical_projection" },
    };
  }

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return [records["conn-1"]] as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "prompts") return [] as T[];
      if (entity === "regex-scripts") return [] as T[];
      if (entity === "agents") return [] as T[];
      if (entity === "memory-capture-jobs") return Array.from(memoryCaptureJobs.values()) as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return records[chat.id] as T;
      if (entity === "connections" && id === "conn-1") return records["conn-1"] as T;
      if (entity === "characters" && id === "char-1") return records["char-1"] as T;
      if (entity === "memory-capture-jobs") return (memoryCaptureJobs.get(id) ?? null) as T | null;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      if (entity === "memory-capture-jobs") {
        const row = { ...value, id: String(value.id) };
        memoryCaptureJobs.set(row.id, row);
        return row as T;
      }
      return { id: "created", ...value } as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      if (entity === "memory-capture-jobs") {
        const row = { ...(memoryCaptureJobs.get(id) ?? { id }), ...patch };
        memoryCaptureJobs.set(id, row);
        return row as T;
      }
      records[id] = { ...(records[id] ?? { id, entity }), ...patch };
      return records[id] as T;
    },
    async delete(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message: StoredMessage = {
        id: `message-${nextMessageId++}`,
        chatId,
        role: String(value.role ?? ""),
        content: String(value.content ?? ""),
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        extra: (value.extra as Record<string, unknown> | undefined) ?? {},
        createdAt: new Date(Date.UTC(2026, 0, nextMessageId)).toISOString(),
      };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      Object.assign(message, patch);
      return message as T;
    },
    async deleteChatMessage(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...(message.extra ?? {}), ...patch };
      return message as T;
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      chat.metadata = { ...chat.metadata, ...patch };
      records[chatId] = chat;
      return chat as T;
    },
    async patchChatSummaries<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], ...patch };
      return records[chatId] as T;
    },
    async listChatMemories<T = unknown>(chatId: string): Promise<T[]> {
      return (chatId === chat.id ? chat.memories : []) as T[];
    },
    async refreshChatMemories<T = unknown>(chatId: string, options?: RefreshChatMemoriesOptions): Promise<T> {
      refreshCount += 1;
      refreshCalls.push({ chatId, options });
      const visible = messages.filter((message) => message.chatId === chatId && message.content.trim());
      const hasTranscriptChunk = chat.memories.some(
        (memory) => Array.isArray(memory.messageIds) && memory.memoryKind !== "imported",
      );
      if (visible.length >= 5 && !hasTranscriptChunk) {
        const chunk = visible.slice(0, 5);
        const content = chunk.map((message) => `${message.role}: ${message.content}`).join("\n");
        chat.memories = [
          {
            id: "memory-1",
            chatId,
            content,
            canonicalMemoryVersion: 1,
            memoryKind: "transcript",
            scopeType: "chat",
            scopeId: chatId,
            status: "active",
            legacySourceLane: "chats.memories",
            legacySourceId: "memory-1",
            creationReason: "Automatic transcript chunk capture",
            messageCount: chunk.length,
            messageIds: chunk.map((message) => message.id),
            firstMessageId: chunk[0]?.id ?? null,
            lastMessageId: chunk.at(-1)?.id ?? null,
            firstMessageAt: chunk[0]?.createdAt ?? "",
            lastMessageAt: chunk.at(-1)?.createdAt ?? "",
            createdAt: new Date(Date.UTC(2026, 0, 20)).toISOString(),
            hasEmbedding: true,
            embedding: tokenVector(content),
            embeddingStatus: "vectorized",
            embeddingSource: "lexical",
          },
          ...chat.memories,
        ];
      }
      return { rebuilt: chat.memories.length } as T;
    },
    async getWorldState<T = unknown>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async addChatMessageSwipe<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
  };

  return {
    storage,
    messages,
    memoryCaptureJobs,
    refreshCalls,
    seedLegacyImportedChat,
    migrateLegacyImportedChat,
    get refreshCount() {
      return refreshCount;
    },
  };
}

function memoryAwareLlm(calls: LlmRequest[]): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    async *stream(request) {
      calls.push(request);
      const promptText = request.messages.map((message) => message.content).join("\n");
      yield {
        type: "token",
        text:
          promptText.includes("<memories>") && promptText.includes("blue lantern")
            ? "You hid the key under the blue lantern."
            : promptText.includes("<memories>") && promptText.includes("jasmine tea")
              ? "Mira keeps jasmine tea for the user after patrols."
              : "I do not remember.",
      };
    },
    listModels: vi.fn(async () => []),
    embed: vi.fn(async ({ texts }) => texts.map(tokenVector)),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration Memory Recall preflight", () => {
  it("passes the saved user and assistant messages to automatic memory refresh", async () => {
    const calls: LlmRequest[] = [];
    const harness = memoryRecallStorage();
    const deps = {
      storage: harness.storage,
      llm: memoryAwareLlm(calls),
      integrations: {} as IntegrationGateway,
    };

    await collectEvents(
      startGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        userMessage: "My cat's name is Miso.",
      }),
    );
    await vi.waitFor(() =>
      expect(Array.from(harness.memoryCaptureJobs.values()).at(-1)).toEqual(
        expect.objectContaining({ status: "completed" }),
      ),
    );

    expect(harness.refreshCalls.at(-1)).toEqual({
      chatId: "chat-1",
      options: { sourceMessageIds: ["message-1", "message-2"] },
    });
    expect(Array.from(harness.memoryCaptureJobs.values())).toEqual([
      expect.objectContaining({
        status: "completed",
        chatId: "chat-1",
        sourceMessageIds: ["message-1", "message-2"],
        assistantMessageId: "message-2",
        userMessageId: "message-1",
      }),
    ]);
  });

  it("extracts a memory after generation and injects it into the next generation", async () => {
    const calls: LlmRequest[] = [];
    const harness = memoryRecallStorage();
    const deps = {
      storage: harness.storage,
      llm: memoryAwareLlm(calls),
      integrations: {} as IntegrationGateway,
    };

    for (const userMessage of [
      "I hid the key under the blue lantern.",
      "The night market is loud.",
      "Mira waved from the bridge.",
    ]) {
      await collectEvents(startGeneration(deps, { chatId: "chat-1", connectionId: "conn-1", userMessage }));
    }
    await vi.waitFor(async () => {
      expect(await harness.storage.listChatMemories("chat-1")).toHaveLength(1);
    });

    await collectEvents(
      startGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        userMessage: "Where did I hide the key?",
      }),
    );

    const lastCall = calls.at(-1);
    const lastPrompt = lastCall?.messages.map((message) => message.content).join("\n") ?? "";
    const assistantMessages = harness.messages.filter((message) => message.role === "assistant");
    expect(lastPrompt).toContain("<memories>");
    expect(lastPrompt).toContain("I hid the key under the blue lantern.");
    expect(assistantMessages.at(-1)?.content).toBe("You hid the key under the blue lantern.");
  });

  it("migrates old imported memory, injects fallback index recall, and captures the next canonical memory", async () => {
    const calls: LlmRequest[] = [];
    const harness = memoryRecallStorage();
    harness.seedLegacyImportedChat();
    harness.migrateLegacyImportedChat();
    const migrated = await harness.storage.listChatMemories<Record<string, unknown>>("chat-1");
    expect(migrated[0]).toEqual(
      expect.objectContaining({
        canonicalMemoryVersion: 1,
        memoryKind: "imported",
        hasEmbedding: true,
        embeddingSource: "lexical",
      }),
    );

    const deps = {
      storage: harness.storage,
      llm: memoryAwareLlm(calls),
      integrations: {} as IntegrationGateway,
    };

    await collectEvents(
      startGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        userMessage: "What tea does Mira keep for me after patrols?",
      }),
    );
    await vi.waitFor(async () => {
      expect(await harness.storage.listChatMemories<Record<string, unknown>>("chat-1")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canonicalMemoryVersion: 1,
            memoryKind: "transcript",
            scopeType: "chat",
            scopeId: "chat-1",
            legacySourceLane: "chats.memories",
          }),
        ]),
      );
    });

    const promptText =
      calls
        .at(-1)
        ?.messages.map((message) => message.content)
        .join("\n") ?? "";
    expect(promptText).toContain("<memories>");
    expect(promptText).toContain("jasmine tea");

    const memories = await harness.storage.listChatMemories<Record<string, unknown>>("chat-1");
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalMemoryVersion: 1,
          memoryKind: "transcript",
          scopeType: "chat",
          scopeId: "chat-1",
          legacySourceLane: "chats.memories",
        }),
      ]),
    );
  });
});
