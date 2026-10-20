import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { ChatMessageListOptions, StorageEntity, StorageGateway } from "../capabilities/storage";
import { startGeneration } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "test-model" };
const SCAN_REPLY = JSON.stringify({
  habits: [{ habit: "Ending on a bedtime order", replies: [1, 2], quotes: ["go to bed"] }],
});

/** One chat with an earlier reply, so the reply this turn writes makes a scan due. */
function chatStorage(chat: Row) {
  const messages: Row[] = [
    { id: "m-1", chatId: chat.id, role: "assistant", content: "ok. go to bed.", createdAt: "2026-10-20T10:00:00.000Z" },
    { id: "m-2", chatId: chat.id, role: "user", content: "no", createdAt: "2026-10-20T10:01:00.000Z" },
  ];
  const patchChatMetadata = vi.fn(async (_chatId: string, patch: Row) => {
    chat.metadata = { ...(chat.metadata as Row), ...patch };
    return chat;
  });
  const storage = {
    async list<T = unknown>(_entity: StorageEntity): Promise<T[]> {
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
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
  return { storage, patchChatMetadata };
}

function llm(): LlmGateway & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn(async (request: LlmRequest) =>
      request.messages[0]?.content.includes("find the habits") ? SCAN_REPLY : "",
    ),
    async *stream() {
      yield { type: "token" as const, text: "fine. go to bed." };
    },
    listModels: vi.fn(async () => []),
  } as LlmGateway & { complete: ReturnType<typeof vi.fn> };
}

async function turn(chat: Row, request: Row = {}) {
  const { storage, patchChatMetadata } = chatStorage(chat);
  const gateway = llm();
  for await (const _event of startGeneration(
    { storage, llm: gateway, integrations: {} as IntegrationGateway },
    { chatId: String(chat.id), connectionId: CONNECTION.id, userMessage: "what are you doing", ...request },
  )) {
    // Run the turn to the end, as the app does.
  }
  // The scan starts on a timer once the turn has written everything; every fake here answers at once.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const scanCalls = gateway.complete.mock.calls.filter(([request]) =>
    String((request as LlmRequest).messages[0]?.content).includes("find the habits"),
  );
  const stored = patchChatMetadata.mock.calls.map(([, patch]) => patch).filter((patch) => "habitScan" in patch);
  return { scanCalls, stored };
}

describe("habit scan after a reply", () => {
  it("scans a Conversation chat after the reply is saved and stores what it found", async () => {
    const { scanCalls, stored } = await turn({
      id: "chat-1",
      mode: "conversation",
      connectionId: CONNECTION.id,
      metadata: {},
    });

    expect(scanCalls).toHaveLength(1);
    expect(String((scanCalls[0]![0] as LlmRequest).messages[0]?.content)).toContain("texts a character sent");
    expect(stored).toEqual([
      {
        habitScan: expect.objectContaining({
          version: 2,
          habits: [{ habit: "Ending on a bedtime order", replies: 2, quotes: ["go to bed"] }],
        }),
      },
    ]);
  });

  it("does not scan an impersonated turn, or a chat with the check turned off", async () => {
    const impersonated = await turn(
      { id: "chat-2", mode: "conversation", connectionId: CONNECTION.id, metadata: {} },
      { impersonate: true },
    );
    const switchedOff = await turn({
      id: "chat-3",
      mode: "roleplay",
      connectionId: CONNECTION.id,
      metadata: { automaticRoleplayQualityCorrection: false },
    });

    const conversationOff = await turn({
      id: "chat-4",
      mode: "conversation",
      connectionId: CONNECTION.id,
      metadata: { automaticRoleplayQualityCorrection: false },
    });

    expect(impersonated.scanCalls).toHaveLength(0);
    expect(switchedOff.scanCalls).toHaveLength(0);
    expect(conversationOff.scanCalls).toHaveLength(0);
  });
});
