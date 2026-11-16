import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { ChatMessageListOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "../contracts/types/generation";
import { startGeneration } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "test-model" };
const MIRA = { id: "char-1", name: "Mira", data: { name: "Mira", description: "Mira texts short." } };

/** One Conversation chat with one character and a short history. */
function chatStorage(chat: Row) {
  const messages: Row[] = [
    { id: "m-1", chatId: chat.id, role: "assistant", content: "ok. go to bed.", createdAt: "2026-10-20T10:00:00.000Z" },
    { id: "m-2", chatId: chat.id, role: "user", content: "no", createdAt: "2026-10-20T10:01:00.000Z" },
  ];
  const patchChatMetadata = async (_chatId: string, patch: Row) => {
    chat.metadata = { ...(chat.metadata as Row), ...patch };
    return chat;
  };
  const storage = {
    async list<T = unknown>(_entity: StorageEntity): Promise<T[]> {
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
      if (entity === "characters" && id === MIRA.id) return MIRA as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Row): Promise<T> {
      return { id: "record-1", ...value } as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(_chatId: string, options?: ChatMessageListOptions): Promise<T[]> {
      const rows = options?.descending ? [...messages].reverse() : [...messages];
      return (options?.limit ? rows.slice(0, options.limit) : rows) as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Row): Promise<T> {
      const row = {
        id: `m-${messages.length + 1}`,
        chatId,
        createdAt: new Date(Date.UTC(2026, 9, 20, 10, messages.length)).toISOString(),
        ...value,
      };
      messages.push(row);
      return row as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
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
    patchChatMetadata,
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories<T = unknown>() {
      return [] as T[];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Row): Promise<T> {
      return snapshot as T;
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  } as unknown as StorageGateway;
  return { storage, messages };
}

function llm(prompts: LlmRequest[], reply: string): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    async *stream(request: LlmRequest) {
      prompts.push(request);
      yield { type: "token" as const, text: reply };
    },
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway;
}

async function callReply(modelReply: string, voiceCallDeliveryTags: boolean) {
  const chat: Row = {
    id: "chat-1",
    mode: "conversation",
    characterIds: ["char-1"],
    connectionId: CONNECTION.id,
    metadata: {},
  };
  const { storage, messages } = chatStorage(chat);
  const prompts: LlmRequest[] = [];
  const events: GenerationEvent[] = [];
  for await (const event of startGeneration(
    { storage, llm: llm(prompts, modelReply), integrations: {} as unknown as IntegrationGateway },
    {
      chatId: "chat-1",
      connectionId: CONNECTION.id,
      userMessage: "how was your night",
      ...(voiceCallDeliveryTags ? { voiceCallDeliveryTags: true } : {}),
    },
  )) {
    events.push(event as GenerationEvent);
  }
  const saved = messages.filter((message) => message.role === "assistant").at(-1);
  const prompt = prompts.map((request) => request.messages.map((message) => message.content).join("\n")).join("\n");
  return { saved, prompt, events };
}

describe("delivery tags on a voice call", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers the tags to a voice that performs them, and saves the reply without them", async () => {
    const { saved, prompt, events } = await callReply("[sighs] long night. [laughs] kidding, it was fine.", true);

    expect(prompt).toContain("This reply is spoken out loud on a voice call");
    expect(saved?.content).toBe("long night. kidding, it was fine.");
    // The streamed text the chat showed is replaced with the clean one.
    expect(events).toContainEqual({ type: "content_replace", data: "long night. kidding, it was fine." });
  });

  it("leaves other replies alone", async () => {
    const { saved, prompt } = await callReply("[sighs] long night.", false);

    expect(prompt).not.toContain("voice call");
    expect(saved?.content).toBe("[sighs] long night.");
  });
});
