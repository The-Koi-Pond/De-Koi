import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

const IMAGE_DATA_URL = "data:image/png;base64,aGVsbG8=";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
};

function imageAttachmentStorage(
  connectionOverrides: Record<string, unknown> = {},
  options: {
    visionConnection?: Record<string, unknown>;
  } = {},
) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "conversation",
      connectionId: "conn-1",
      characterIds: ["char-a"],
      metadata: options.visionConnection ? { visionConnectionId: "conn-vision" } : {},
    },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model", ...connectionOverrides },
    ...(options.visionConnection
      ? {
          "conn-vision": {
            id: "conn-vision",
            provider: "test-provider",
            model: "vision-model",
            ...options.visionConnection,
          },
        }
      : {}),
    "char-a": { id: "char-a", name: "Aki", data: { name: "Aki", personality: "warm" } },
  };
  const messages: StoredMessage[] = [
    {
      id: "message-1",
      chatId: "chat-1",
      role: "user",
      content: "",
      characterId: null,
      activeSwipeIndex: 0,
      swipeCount: 1,
      extra: {
        attachments: [{ type: "image/png", galleryId: "gallery-1", filename: "cat.png", name: "cat.png" }],
      },
    },
  ];
  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return Object.values(records).filter((record) => record.provider) as T[];
      if (entity === "personas") return [] as T[];
      if (entity === "prompts") return [] as T[];
      if (entity === "regex-scripts") return [] as T[];
      if (entity === "agents") return [] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return records["chat-1"] as T;
      if (entity === "connections" && records[id]?.provider) return records[id] as T;
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
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message: StoredMessage = {
        id: `message-${messages.length + 1}`,
        chatId,
        role: String(value.role ?? ""),
        content: String(value.content ?? ""),
        characterId: typeof value.characterId === "string" ? value.characterId : null,
        activeSwipeIndex: 0,
        swipeCount: 1,
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
      message.extra = { ...message.extra, ...patch };
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
    async resolveImageAttachmentDataUrl() {
      return IMAGE_DATA_URL;
    },
  };

  return { storage, messages };
}

function capturingLlm(requests: LlmRequest[]): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    async *stream(request) {
      requests.push(request);
      yield { type: "token", text: "I can see it." };
    },
    listModels: vi.fn(async () => []),
  };
}

async function collectEvents(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe("startGeneration image attachments", () => {
  it("rehydrates stored image attachments into the model request", async () => {
    const { storage } = imageAttachmentStorage();
    const requests: LlmRequest[] = [];

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: capturingLlm(requests),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests.flatMap((request) => request.messages.flatMap((message) => message.images ?? []))).toContain(
      IMAGE_DATA_URL,
    );
  });

  it("routes an image-bearing foreground request through the configured vision connection", async () => {
    const { storage } = imageAttachmentStorage(
      { capabilities: { vision: false } },
      { visionConnection: { capabilities: { vision: true } } },
    );
    const requests: LlmRequest[] = [];

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: capturingLlm(requests),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what is in this image?",
          attachments: [{ type: "image/png", data: IMAGE_DATA_URL, filename: "cat.png", name: "cat.png" }],
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests.at(-1)?.connectionId).toBe("conn-vision");
    expect(requests.flatMap((request) => request.messages.flatMap((message) => message.images ?? []))).toContain(
      IMAGE_DATA_URL,
    );
  });

  it("keeps text-only foreground requests on the normal chat connection", async () => {
    const { storage } = imageAttachmentStorage(
      { capabilities: { vision: true } },
      { visionConnection: { capabilities: { vision: true } } },
    );
    const requests: LlmRequest[] = [];

    await collectEvents(
      startGeneration(
        { storage, llm: capturingLlm(requests), integrations: {} as IntegrationGateway },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "hello",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests.at(-1)?.connectionId).toBe("conn-1");
  });

  it("keeps attachment metadata out of newly saved and forwarded message text", async () => {
    const { storage, messages } = imageAttachmentStorage();
    const requests: LlmRequest[] = [];

    await collectEvents(
      startGeneration(
        {
          storage,
          llm: capturingLlm(requests),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          userMessage: "what is in this image?",
          attachments: [
            {
              type: "image/png",
              data: IMAGE_DATA_URL,
              filename: "cat.png",
              name: "cat.png",
            },
          ],
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(messages.filter((message) => message.role === "user").at(-1)?.content).toBe("what is in this image?");
    expect(requests.flatMap((request) => request.messages.map((message) => message.content))).not.toContain(
      "what is in this image?\n\n[Attached image: cat.png]",
    );
  });

  it("warns visibly and clears stored images when the selected model is not vision-capable", async () => {
    const { storage } = imageAttachmentStorage({ capabilities: { vision: false } });
    const requests: LlmRequest[] = [];

    const events = await collectEvents(
      startGeneration(
        {
          storage,
          llm: capturingLlm(requests),
          integrations: {} as IntegrationGateway,
        },
        {
          chatId: "chat-1",
          connectionId: "conn-1",
          impersonateBlockAgents: true,
        },
      ),
    );

    expect(requests.flatMap((request) => request.messages.flatMap((message) => message.images ?? []))).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent_warning",
        data: expect.objectContaining({
          code: "image_attachment_delivery",
          message: expect.stringContaining("not vision-capable"),
        }),
      }),
    );
  });
});
