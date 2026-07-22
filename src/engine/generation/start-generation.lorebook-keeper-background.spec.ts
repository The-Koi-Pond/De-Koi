import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function lorebookKeeperBackgroundStorage() {
  const agentRuns = deferred<Record<string, unknown>[]>();
  const chat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "conn-1",
    characterIds: [],
    metadata: { activeAgentIds: ["lorebook-keeper"] },
  };
  const connection = { id: "conn-1", provider: "test-provider", model: "test-model" };
  const messages: Record<string, unknown>[] = [];
  let backfillStarted = false;

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") {
        return [
          {
            id: "lorebook-keeper",
            type: "lorebook-keeper",
            enabled: true,
            settings: { runInterval: 1 },
          },
        ] as T[];
      }
      if (entity === "agent-runs") {
        backfillStarted = true;
        return (await agentRuns.promise) as T[];
      }
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
      return null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: `message-${messages.length + 1}`, ...value } as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message = { id: `message-${messages.length + 1}`, chatId, ...value };
      messages.push(message);
      return message as T;
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
    async patchChatMetadata<T = unknown>() {
      return {} as T;
    },
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories<T = unknown>() {
      return [] as T[];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return {} as T;
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull<T = unknown>() {
      return null;
    },
  };

  return {
    storage,
    releaseBackfill() {
      const assistantMessageId = String(messages.find((message) => message.role === "assistant")?.id ?? "");
      agentRuns.resolve([
        {
          id: "processed-assistant-message",
          chatId: chat.id,
          messageId: assistantMessageId,
          agentType: "lorebook-keeper",
          success: true,
        },
      ]);
    },
    backfillStarted: () => backfillStarted,
  };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

describe("startGeneration Lorebook Keeper backfill", () => {
  it("starts the normal-path Keeper backfill after done even when the consumer stops iteration", async () => {
    vi.useFakeTimers();
    const { storage, releaseBackfill, backfillStarted } = lorebookKeeperBackgroundStorage();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Keep the lantern lit.", impersonateBlockAgents: true },
    );

    try {
      await advanceToDone(generation);
      expect(backfillStarted()).toBe(false);
      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(backfillStarted()).toBe(true);
      releaseBackfill();
    } finally {
      releaseBackfill();
      vi.useRealTimers();
    }
  });

  it("starts the direct-message Keeper backfill after done and detaches foreground cancellation", async () => {
    vi.useFakeTimers();
    const { storage, releaseBackfill, backfillStarted } = lorebookKeeperBackgroundStorage();
    const controller = new AbortController();
    const llm: LlmGateway = {
      complete: vi.fn(async () => ""),
      async *stream() {
        yield { type: "token", text: "The lantern stays lit." };
      },
      listModels: vi.fn(async () => []),
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Keep the lantern lit." }],
        impersonateBlockAgents: true,
      },
      controller.signal,
    );

    try {
      await advanceToDone(generation);
      expect(backfillStarted()).toBe(false);
      controller.abort();
      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(backfillStarted()).toBe(true);
      releaseBackfill();
    } finally {
      releaseBackfill();
      vi.useRealTimers();
    }
  });
});
