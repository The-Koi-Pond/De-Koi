import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmChunk, LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
  swipes: Array<{ content: string; extra: Record<string, unknown> }>;
};

/** A plain conversation chat: the options must work without any mode knowing about them. */
function conversationStorage() {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": { id: "chat-1", mode: "conversation", connectionId: "conn-1", characterIds: [], metadata: {} },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
  };
  const messages: StoredMessage[] = [];
  const swipeExtras: Array<Record<string, unknown>> = [];
  const extraPatches: Array<Record<string, unknown>> = [];
  const storage = {
    async list<T>(entity: StorageEntity): Promise<T[]> {
      return (entity === "connections" ? [records["conn-1"]] : []) as T[];
    },
    async get<T>(entity: StorageEntity, id: string): Promise<T | null> {
      return ((entity === "chats" || entity === "connections") && records[id] ? records[id] : null) as T | null;
    },
    async create<T>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T>(_entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      records[id] = { ...records[id], ...patch };
      return records[id] as T;
    },
    async listChatMessages<T>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async getChatMessage<T>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const content = String(value.content ?? "");
      const extra = { ...((value.extra as Record<string, unknown> | undefined) ?? {}) };
      const message: StoredMessage = {
        id: `message-${messages.length + 1}`,
        chatId,
        role: String(value.role ?? ""),
        content,
        activeSwipeIndex: 0,
        swipeCount: 1,
        extra,
        swipes: [{ content, extra: { ...extra } }],
      };
      messages.push(message);
      return message as T;
    },
    async updateChatMessage<T>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId)!;
      Object.assign(message, patch);
      return message as T;
    },
    async patchChatMessageExtra<T>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      extraPatches.push(patch);
      const message = messages.find((item) => item.id === messageId)!;
      message.extra = { ...message.extra, ...patch };
      return message as T;
    },
    async addChatMessageSwipe<T>(
      _chatId: string,
      messageId: string,
      content: string,
      options?: { extra?: Record<string, unknown> },
    ): Promise<T> {
      swipeExtras.push(options?.extra ?? {});
      const message = messages.find((item) => item.id === messageId)!;
      message.swipes.push({ content, extra: options?.extra ?? {} });
      message.swipeCount = message.swipes.length;
      message.activeSwipeIndex = message.swipes.length - 1;
      message.content = content;
      return message as T;
    },
    async patchChatMetadata<T>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
    async patchChatSummaries<T>(chatId: string): Promise<T> {
      return records[chatId] as T;
    },
    async listChatMemories<T>(): Promise<T[]> {
      return [];
    },
    async getWorldState<T>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T>(): Promise<T[]> {
      return [];
    },
    async promptFull<T>(): Promise<T | null> {
      return null;
    },
  } as unknown as StorageGateway;
  return { storage, messages, swipeExtras, extraPatches };
}

function replyLlm(chunks: LlmChunk[], failure?: Error): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    listModels: vi.fn(async () => []),
    async *stream() {
      yield* chunks;
      if (failure) throw failure;
    },
  };
}

async function drain(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  for await (const _event of generator) {
    // Run the generation to the end.
  }
}

const deps = (storage: StorageGateway, llm: LlmGateway) => ({ storage, llm, integrations: {} as IntegrationGateway });
const VERSION = { models: [{ connectionId: "conn-1", name: "Writer", model: "test-model" }] };

/** Without the volatile prompt snapshot, which records when it was taken. */
function stableExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const { generationPromptSnapshot: _snapshot, ...rest } = extra;
  return rest;
}

describe("startGeneration savedExtra", () => {
  it("adds the caller's extra to a new reply", async () => {
    const { storage, messages } = conversationStorage();

    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
        savedExtra: { fanficVersion: VERSION },
      }),
    );

    const reply = messages.find((message) => message.role === "assistant");
    expect(reply?.extra.fanficVersion).toEqual(VERSION);
  });

  it("adds the caller's extra to a regenerated version, on the swipe and the message", async () => {
    const { storage, messages, swipeExtras, extraPatches } = conversationStorage();
    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "First." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );
    const reply = messages.find((message) => message.role === "assistant")!;

    await drain(
      startGeneration(deps(storage, replyLlm([{ type: "token", text: "Second." }])), {
        chatId: "chat-1",
        regenerateMessageId: reply.id,
        savedExtra: { fanficVersion: VERSION },
      }),
    );

    expect(swipeExtras.at(-1)?.fanficVersion).toEqual(VERSION);
    expect(extraPatches.at(-1)?.fanficVersion).toEqual(VERSION);
    expect(reply.swipes[0]!.extra.fanficVersion).toBeUndefined();
  });

  it("keeps the caller's extra on the partial reply saved when the stream breaks", async () => {
    const { storage, messages } = conversationStorage();
    const broken = Object.assign(new Error("LLM provider stream ended before a terminal event."), {
      code: "llm_stream_incomplete",
    });

    await expect(
      drain(
        startGeneration(deps(storage, replyLlm([{ type: "token", text: "The reply began, but" }], broken)), {
          chatId: "chat-1",
          userMessage: "Hi.",
          savedExtra: { fanficVersion: VERSION },
        }),
      ),
    ).rejects.toMatchObject({ code: "llm_stream_incomplete" });

    const reply = messages.find((message) => message.role === "assistant");
    expect(reply?.content).toBe("The reply began, but");
    expect(reply?.extra.fanficVersion).toEqual(VERSION);
  });

  it("saves the same reply as before when no extra is given, and never lets the caller replace a key the engine wrote", async () => {
    const plain = conversationStorage();
    await drain(
      startGeneration(deps(plain.storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
      }),
    );
    const withExtra = conversationStorage();
    await drain(
      startGeneration(deps(withExtra.storage, replyLlm([{ type: "token", text: "Hello there." }])), {
        chatId: "chat-1",
        userMessage: "Hi.",
        savedExtra: { fanficVersion: VERSION, chatSummaryFingerprint: "caller", answersUserVersion: "caller" },
      }),
    );

    const plainReply = plain.messages.find((message) => message.role === "assistant")!;
    const extraReply = withExtra.messages.find((message) => message.role === "assistant")!;
    expect(plainReply.extra).not.toHaveProperty("fanficVersion");
    const { fanficVersion: _version, ...engineKeys } = stableExtra(extraReply.extra);
    expect(engineKeys).toEqual(stableExtra(plainReply.extra));
    expect(extraReply.extra.chatSummaryFingerprint).not.toBe("caller");
    expect(extraReply.extra.answersUserVersion).not.toBe("caller");
  });
});
