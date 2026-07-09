import { describe, expect, it, vi } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import {
  cancelConversationSummaryBackfill,
  scheduleConversationSummaryBackfill,
} from "../modes/chat/core/summaries/conversation-summary-background";
import { startGeneration, type GenerationEngineDeps } from "./start-generation";

async function drain(stream: AsyncGenerator<unknown>) {
  for await (const _event of stream) {
    // Exhaust generation so summary and prompt assembly side effects finish.
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function depsForConversationSummaryGeneration(summaryCompletion?: Promise<string>) {
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
    summaryCompletion
      ? summaryCompletion
      : JSON.stringify({ summary: "SAME_TURN_SUMMARY_AVAILABLE", keyDetails: ["timezone bucket respected"] }),
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
    getChatMessage: vi.fn(async (messageId: string) => messages.find((message) => message.id === messageId) ?? null),
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
  it("streams the foreground response before background summary completion resolves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const summary = deferred<string>();
    const { deps, storage, complete, streamedRequests } = depsForConversationSummaryGeneration(summary.promise);
    const generation = drain(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "hello",
        impersonateBlockAgents: true,
        userTimeZone: "America/New_York",
      }),
    );

    try {
      await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
      expect(streamedRequests).toHaveLength(1);
      expect(storage.patchChatSummaries).not.toHaveBeenCalled();

      summary.resolve(
        JSON.stringify({ summary: "BACKGROUND_SUMMARY_AVAILABLE", keyDetails: ["timezone bucket respected"] }),
      );
      await generation;
      await vi.waitFor(() =>
        expect(storage.patchChatSummaries).toHaveBeenCalledWith("chat-1", {
          daySummaries: {
            "12.06.2026": {
              summary: "BACKGROUND_SUMMARY_AVAILABLE",
              keyDetails: ["timezone bucket respected"],
            },
          },
          weekSummaries: {},
        }),
      );
    } finally {
      summary.resolve("{}");
      await generation.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("uses a successfully persisted background summary on the next turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const { deps, storage, complete, streamedRequests } = depsForConversationSummaryGeneration();

    try {
      await drain(
        startGeneration(deps, {
          chatId: "chat-1",
          userMessage: "first turn",
          impersonateBlockAgents: true,
          userTimeZone: "America/New_York",
        }),
      );
      await vi.waitFor(() => expect(storage.patchChatSummaries).toHaveBeenCalledTimes(1));

      complete.mockClear();
      await drain(
        startGeneration(deps, {
          chatId: "chat-1",
          userMessage: "second turn",
          impersonateBlockAgents: true,
          userTimeZone: "America/New_York",
        }),
      );

      expect(JSON.stringify(streamedRequests[1]?.messages ?? [])).toContain("SAME_TURN_SUMMARY_AVAILABLE");
      expect(complete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts same-chat background summary work when foreground generation starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const summary = deferred<string>();
    const { deps, complete } = depsForConversationSummaryGeneration(summary.promise);

    scheduleConversationSummaryBackfill(
      { storage: deps.storage, llm: deps.llm },
      { chatId: "chat-1", connectionId: "connection-1", timeZone: "America/New_York" },
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const backgroundSignal = complete.mock.calls[0]?.[1];

    try {
      await drain(
        startGeneration(deps, {
          chatId: "chat-1",
          userMessage: "foreground turn",
          impersonateBlockAgents: true,
          userTimeZone: "America/New_York",
        }),
      );
      expect(backgroundSignal?.aborted).toBe(true);
      await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
      const replacementSignal = complete.mock.calls[1]?.[1];
      expect(replacementSignal).not.toBe(backgroundSignal);
      expect(replacementSignal?.aborted).toBe(false);
    } finally {
      cancelConversationSummaryBackfill(deps.storage, "chat-1");
      summary.resolve("{}");
      vi.useRealTimers();
    }
  });
});
