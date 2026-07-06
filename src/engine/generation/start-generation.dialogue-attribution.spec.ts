import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { createDialogueAttributionTextHash } from "../shared/text/dialogue-attribution";
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

function roleplayAttributionStorage(connectionOverrides: Record<string, unknown> = {}) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "roleplay",
      connectionId: "conn-1",
      characterIds: ["char-a"],
      metadata: {},
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
      const content = String(value.content ?? "").replace(/\n{3,}/g, "\n\n");
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
  };

  return { storage, messages, calls };
}

function roleplayLlm(response: string, completeResponse = ""): LlmGateway {
  return {
    complete: vi.fn(async () => completeResponse),
    async *stream() {
      yield { type: "token", text: response };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration dialogue attribution", () => {
  it("strips speaker tags, reads canonical saved text, and stores attribution on the active swipe", async () => {
    const { storage, messages, calls } = roleplayAttributionStorage();

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: roleplayLlm('<speaker name="Aki">"Hi."</speaker>'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "say hello",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe('"Hi."');
    expect(calls).toEqual(
      expect.arrayContaining([`getChatMessage:${assistant!.id}`, `patchChatMessageExtra:${assistant!.id}`]),
    );
    expect(calls.indexOf(`getChatMessage:${assistant!.id}`)).toBeLessThan(
      calls.indexOf(`patchChatMessageExtra:${assistant!.id}`),
    );
    expect(assistant!.extra.dialogueAttributions).toEqual({
      version: 1,
      textHash: createDialogueAttributionTextHash('"Hi."'),
      segments: [
        { start: 0, end: 5, speakerName: "Aki", speakerId: "char-a", source: "speaker-tag", confidence: "explicit" },
      ],
    });
    expect(assistant!.swipes[0]?.extra?.dialogueAttributions).toEqual(assistant!.extra.dialogueAttributions);
  });

  it("stores Name-prefix attribution against the canonical saved text without a model call", async () => {
    const { storage, messages, calls } = roleplayAttributionStorage();

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: roleplayLlm('Aki: "Hi."'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "say hello",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe('"Hi."');
    expect(calls).toEqual(
      expect.arrayContaining([`getChatMessage:${assistant!.id}`, `patchChatMessageExtra:${assistant!.id}`]),
    );
    expect(assistant!.extra.dialogueAttributions).toEqual({
      version: 1,
      textHash: createDialogueAttributionTextHash('"Hi."'),
      segments: [
        { start: 0, end: 5, speakerName: "Aki", speakerId: "char-a", source: "name-prefix", confidence: "explicit" },
      ],
    });
    expect(assistant!.swipes[0]?.extra?.dialogueAttributions).toEqual(assistant!.extra.dialogueAttributions);
  });
  it("uses the selected sidecar model for ambiguous quoted dialogue", async () => {
    const { storage, messages } = roleplayAttributionStorage({ provider: "sidecar", model: "local-sidecar" });

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: roleplayLlm('Aki smiled. "Hi."', '[{"quote":"\\"Hi.\\"","speaker":"Aki"}]'),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "say hello",
          impersonateBlockAgents: true,
        },
      ),
    );

    const assistant = messages.find((item) => item.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.content).toBe('Aki smiled. "Hi."');
    expect(assistant!.extra.dialogueAttributions).toEqual({
      version: 1,
      textHash: createDialogueAttributionTextHash('Aki smiled. "Hi."'),
      segments: [
        { start: 12, end: 17, speakerName: "Aki", speakerId: "char-a", source: "sidecar-model", confidence: "derived" },
      ],
    });
    expect(assistant!.swipes[0]?.extra?.dialogueAttributions).toEqual(assistant!.extra.dialogueAttributions);
  });
});
