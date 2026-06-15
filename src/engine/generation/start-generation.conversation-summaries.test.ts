import { describe, expect, it, vi } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { startGeneration, type GenerationEngineDeps } from "./start-generation";

async function drain(stream: AsyncGenerator<unknown>) {
  for await (const _event of stream) {
    // Exhaust generation so summary and prompt assembly side effects finish.
  }
}

function depsForConversationSummaryGeneration() {
  const chat: Record<string, unknown> = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "connection-1",
    characterIds: [],
    metadata: {
      dayRolloverHour: 0,
      promptTimeZone: "America/New_York",
    },
  };
  const connection = {
    id: "connection-1",
    provider: "custom",
    model: "test-model",
    baseUrl: "http://localhost:1234/v1",
    defaultParameters: {},
  };
  const messages: Record<string, unknown>[] = [
    {
      id: "old-user",
      chatId: "chat-1",
      role: "user",
      content: "OLD_RAW_DETAIL_SHOULD_BE_SUMMARIZED",
      createdAt: "2026-06-13T03:30:00.000Z",
    },
  ];
  const streamedRequests: LlmRequest[] = [];
  const complete = vi.fn<LlmGateway["complete"]>(async () =>
    JSON.stringify({ summary: "SAME_TURN_SUMMARY_AVAILABLE", keyDetails: ["timezone bucket respected"] }),
  );
  const stream: LlmGateway["stream"] = vi.fn(async function* (request) {
    streamedRequests.push(request);
    yield { type: "token" as const, text: "Done." };
  });
  const storage = {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats" && id === "chat-1") return chat;
      if (entity === "connections" && id === "connection-1") return connection;
      return null;
    }),
    list: vi.fn(async () => []),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => value),
    update: vi.fn(async (_entity: string, id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    delete: vi.fn(async () => ({ deleted: true })),
    listChatMessages: vi.fn(async () => [...messages]),
    createChatMessage: vi.fn(async (_chatId: string, value: Record<string, unknown>) => {
      const saved = { id: value.role === "user" ? "new-user" : "assistant-1", chatId: "chat-1", ...value };
      messages.push(saved);
      return saved;
    }),
    updateChatMessage: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    deleteChatMessage: vi.fn(async () => ({ deleted: true })),
    patchChatMessageExtra: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    addChatMessageSwipe: vi.fn(async () => ({})),
    patchChatMetadata: vi.fn(async () => chat),
    patchChatSummaries: vi.fn(async (_chatId: string, patch: Record<string, unknown>) => {
      chat.metadata = { ...(chat.metadata as Record<string, unknown>), ...patch };
      return chat;
    }),
    listChatMemories: vi.fn(async () => []),
    getWorldState: vi.fn(async () => null),
    saveTrackerSnapshot: vi.fn(async (_chatId: string, snapshot: Record<string, unknown>) => snapshot),
    listLorebookEntries: vi.fn(async () => []),
    listLorebookEntriesByLorebookIds: vi.fn(async () => []),
    createLorebookEntries: vi.fn(async () => []),
    promptFull: vi.fn(async () => null),
  } as Partial<StorageGateway> as StorageGateway & {
    patchChatSummaries: ReturnType<typeof vi.fn>;
  };
  const llm: LlmGateway = {
    stream,
    complete,
    listModels: vi.fn(async () => []),
  };
  const deps: GenerationEngineDeps = {
    storage,
    llm,
    integrations: {} as IntegrationGateway,
  };
  return { deps, storage, complete, streamedRequests };
}

describe("startGeneration conversation summary preparation", () => {
  it("awaits missing conversation summaries before assembling the prompt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const { deps, storage, complete, streamedRequests } = depsForConversationSummaryGeneration();
    const controller = new AbortController();

    try {
      await drain(
        startGeneration(
          deps,
          {
            chatId: "chat-1",
            userMessage: "hello",
            impersonateBlockAgents: true,
            userTimeZone: "America/New_York",
          },
          controller.signal,
        ),
      );

      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0]?.[1]).toBe(controller.signal);
      expect(storage.patchChatSummaries).toHaveBeenCalledWith("chat-1", {
        daySummaries: {
          "12.06.2026": {
            summary: "SAME_TURN_SUMMARY_AVAILABLE",
            keyDetails: ["timezone bucket respected"],
          },
        },
        weekSummaries: {},
      });
      expect(JSON.stringify(streamedRequests[0]?.messages ?? [])).toContain("SAME_TURN_SUMMARY_AVAILABLE");
    } finally {
      vi.useRealTimers();
    }
  });
});
