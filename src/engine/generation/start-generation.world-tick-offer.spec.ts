import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
  swipes: Array<{ content: string; characterId?: string | null; extra?: Record<string, unknown> }>;
};

function roleplayAttributionStorage(
  connectionOverrides: Record<string, unknown> = {},
  chatOverrides: Record<string, unknown> = {},
) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "roleplay",
      connectionId: "conn-1",
      characterIds: ["char-a"],
      metadata: {},
      ...chatOverrides,
    },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model", ...connectionOverrides },
    "char-a": {
      id: "char-a",
      name: "Aki",
      data: { name: "Aki", personality: "warm" },
      publicProfile: { displayName: "Aki", handle: "@aki" },
    },
  };
  const messages: StoredMessage[] = [];
  const calls: string[] = [];
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
      if (entity === "characters" && id === "char-a") return records["char-a"] as T;
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
      calls.push(`getChatMessage:${messageId}`);
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      calls.push("createChatMessage");
      const content = String(value.content ?? "");
      const extra = (value.extra as Record<string, unknown> | undefined) ?? {};
      const message: StoredMessage = {
        id: `message-${nextMessageId++}`,
        chatId,
        role: String(value.role ?? ""),
        content,
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        activeSwipeIndex: 0,
        swipeCount: 1,
        extra: { ...extra },
        swipes: [
          {
            content,
            characterId: typeof value.characterId === "string" ? value.characterId : null,
            extra: { ...extra },
          },
        ],
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
      calls.push(`patchChatMessageExtra:${messageId}`);
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...message.extra, ...patch };
      const activeSwipe = message.swipes[message.activeSwipeIndex];
      if (activeSwipe) activeSwipe.extra = { ...(activeSwipe.extra ?? {}), ...patch };
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
      throw new Error("addChatMessageSwipe should not be used for a first assistant message");
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
    async updateChatIfUnchanged<T = unknown>(
      chatId: string,
      expected: Record<string, unknown>,
      patch: Record<string, unknown>,
    ): Promise<{ updated: boolean; chat: T }> {
      const chat = records[chatId]!;
      const metadata = (chat.metadata as Record<string, unknown>) ?? {};
      const expectedMetadata = (expected.metadata as Record<string, unknown>) ?? {};
      for (const [key, value] of Object.entries(expectedMetadata)) {
        if (JSON.stringify(metadata[key] ?? null) !== JSON.stringify(value ?? null))
          return { updated: false, chat: chat as T };
      }
      records[chatId] = { ...chat, metadata: { ...metadata, ...(patch.metadata as Record<string, unknown>) } };
      return { updated: true, chat: records[chatId] as T };
    },
  };

  return { storage, messages, calls, records };
}

function roleplayLlm(response: string | string[], completeResponse = ""): LlmGateway & { requests: LlmRequest[] } {
  const responses = Array.isArray(response) ? response : [response];
  const requests: LlmRequest[] = [];
  let responseIndex = 0;
  return {
    requests,
    complete: vi.fn(async () => completeResponse),
    async *stream(request) {
      requests.push(request);
      yield { type: "token", text: responses[responseIndex++] ?? "" };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function worldTick(records: Record<string, Record<string, unknown>>): Record<string, unknown> | undefined {
  return (records["chat-1"]!.metadata as Record<string, unknown>).roleplayWorldTick as
    | Record<string, unknown>
    | undefined;
}

async function send(
  harness: ReturnType<typeof roleplayAttributionStorage>,
  userMessage: string,
): Promise<GenerationEvent[]> {
  return collectEvents(
    startGeneration(
      { storage: harness.storage, llm: roleplayLlm("Mara looks up."), integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage, impersonateBlockAgents: true },
    ),
  );
}

describe("startGeneration world-tick offers", () => {
  it("offers to let time pass when the user's Roleplay message skips ahead, and still replies", async () => {
    const harness = roleplayAttributionStorage();

    const events = await send(harness, "*Three days later,* I knock on the ferryman's door.");

    expect(events).toContainEqual({
      type: "world_tick_offer",
      data: { chatId: "chat-1", offerId: expect.stringContaining("time_skip:") },
    });
    expect(worldTick(harness.records)?.offer).toMatchObject({
      trigger: "time_skip",
      elapsed: "three days",
      label: "Three days later",
    });
    expect(harness.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    // An offer is only a note: no extra model call and no narrator message.
    expect(harness.messages.some((message) => message.role === "narrator")).toBe(false);
  });

  it("makes no offer for an ordinary message", async () => {
    const harness = roleplayAttributionStorage();

    const events = await send(harness, "I knock on the ferryman's door.");

    expect(events.some((event) => event.type === "world_tick_offer")).toBe(false);
    expect(worldTick(harness.records)).toBeUndefined();
  });

  it("makes no offer outside Roleplay", async () => {
    const harness = roleplayAttributionStorage({}, { mode: "conversation" });

    const events = await send(harness, "Time skip: a week.");

    expect(events.some((event) => event.type === "world_tick_offer")).toBe(false);
    expect(worldTick(harness.records)).toBeUndefined();
  });

  it("respects the chat's switch", async () => {
    const harness = roleplayAttributionStorage({}, { metadata: { roleplayWorldTick: { offersEnabled: false } } });

    const events = await send(harness, "A week later, the harbour is quiet.");

    expect(events.some((event) => event.type === "world_tick_offer")).toBe(false);
    expect(worldTick(harness.records)?.offer).toBeUndefined();
  });

  it("reports a failed offer on the event and still replies", async () => {
    const harness = roleplayAttributionStorage();
    harness.storage.updateChatIfUnchanged = async () => {
      throw new Error("disk full");
    };

    const events = await send(harness, "Time skip: a week.");

    expect(events).toContainEqual({
      type: "world_tick_offer",
      data: { chatId: "chat-1", offerId: null, error: "disk full" },
    });
    expect(harness.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});
