import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  extra?: Record<string, unknown>;
};

function groupTypingStorage(metadata: Record<string, unknown> = { groupResponseOrder: "sequential" }) {
  const chat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "conn-1",
    characterIds: ["char-a", "char-b"],
    metadata,
  };
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": chat,
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
    "char-a": { id: "char-a", name: "Aki", data: { name: "Aki", personality: "warm" } },
    "char-b": { id: "char-b", name: "Bea", data: { name: "Bea", personality: "dry" } },
  };
  const messages: StoredMessage[] = [];
  let nextMessageId = 1;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return [records["conn-1"]] as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "prompts") return [] as T[];
      if (entity === "regex-scripts") return [] as T[];
      if (entity === "agents") return [] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return records["chat-1"] as T;
      if (entity === "connections" && id === "conn-1") return records["conn-1"] as T;
      if (entity === "characters" && (id === "char-a" || id === "char-b")) return records[id] as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: "created", ...value } as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
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
      const message = {
        id: `message-${nextMessageId++}`,
        chatId,
        role: String(value.role ?? ""),
        content: String(value.content ?? ""),
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        extra: (value.extra as Record<string, unknown> | undefined) ?? {},
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
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
    async patchChatSummaries<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], ...patch };
      return records[chatId] as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [] as T[];
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

  return { storage, messages };
}

function groupTypingLlm(selectorResponse = ""): LlmGateway {
  return {
    complete: vi.fn(async () => selectorResponse),
    async *stream() {
      yield { type: "token", text: "hey there" };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration group typing", () => {
  it("lets sequential conversation group responders send separate messages", async () => {
    const { storage, messages } = groupTypingStorage();

    const events = await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm(),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "hello group",
          impersonateBlockAgents: true,
        },
      ),
    );

    const groupTurns = events.filter((event) => event.type === "group_turn");
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(groupTurns.map((event) => event.data)).toEqual([
      { characterId: "char-a", characterName: "Aki", index: 0, total: 2 },
      { characterId: "char-b", characterName: "Bea", index: 1, total: 2 },
    ]);
    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-a", "char-b"]);
  });

  it("lets smart conversation group selection choose multiple responders", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":["char-b","char-a"],"reason":"both would answer"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what do you both think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-b", "char-a"]);
  });

  it("defaults conversation group response order to smart selection", async () => {
    const { storage, messages } = groupTypingStorage({});

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":["char-b"],"reason":"Bea is directly relevant"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what do you think?",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-b"]);
  });

  it("falls back to conversation group turn order when smart selection chooses nobody", async () => {
    const { storage, messages } = groupTypingStorage({ groupResponseOrder: "smart" });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: groupTypingLlm('{"characterIds":[],"reason":"No one needs to answer yet"}'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "Hi",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistantMessages = messages.filter((message) => message.role === "assistant");

    expect(assistantMessages.map((message) => message.characterId)).toEqual(["char-a", "char-b"]);
  });
});
