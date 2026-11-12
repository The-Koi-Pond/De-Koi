// @vitest-environment jsdom
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { chatMessagesInfiniteQueryOptions } from "../chat-query-options";
import { chatKeys } from "../query-keys";
import { useDeleteMessage, useDeleteMessages } from "./use-chats";

// Hooks import useMutation through the app wrapper; route it to the mocked TanStack hook.
vi.mock("../../../../shared/hooks/use-mutation", async () => ({
  useMutation: (await import("@tanstack/react-query")).useMutation,
}));

const reactQueryMocks = vi.hoisted(() => ({
  currentQueryClient: null as QueryClient | null,
  useMutation: vi.fn((options) => options),
}));

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: reactQueryMocks.useMutation,
    useQueryClient: () => {
      if (!reactQueryMocks.currentQueryClient) throw new Error("Missing QueryClient for test.");
      return reactQueryMocks.currentQueryClient;
    },
  };
});

vi.mock("../../../../shared/api/chat-command-api", () => ({
  chatCommandApi: {
    bulkDeleteMessages: vi.fn(),
  },
}));

const storageMocks = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { listChatMessages: storageMocks.listChatMessages },
}));

type DeleteMessageOptions = {
  onMutate: (messageId: string) => unknown;
  onSuccess: (result: unknown, messageId: string) => void;
  onError: (error: unknown, messageId: string, context: unknown) => void;
  onSettled: () => void;
};

type DeleteMessagesOptions = {
  onMutate: (messageIds: string[]) => unknown;
};

function message(id: string, content: string): Message {
  return {
    id,
    chatId: "chat-1",
    role: "user",
    characterId: null,
    content,
    activeSwipeIndex: 0,
    extra: { displayText: null, isGenerated: false, tokenCount: null, generationInfo: null },
    createdAt: "2026-07-03T12:00:00.000Z",
  };
}

function messagePages(messages: Message[]): InfiniteData<Message[]> {
  return { pages: [messages], pageParams: [undefined] };
}

function useDeleteMessageOptions(qc: QueryClient, chatId = "chat-1"): DeleteMessageOptions {
  reactQueryMocks.currentQueryClient = qc;
  return useDeleteMessage(chatId) as unknown as DeleteMessageOptions;
}

function useDeleteMessagesOptions(qc: QueryClient): DeleteMessagesOptions {
  reactQueryMocks.currentQueryClient = qc;
  return useDeleteMessages("chat-1") as unknown as DeleteMessagesOptions;
}

beforeEach(() => {
  reactQueryMocks.currentQueryClient = null;
  reactQueryMocks.useMutation.mockClear();
  storageMocks.listChatMessages.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function fetchTimeline(chatId: string): Promise<string[]> {
  const queryFn = chatMessagesInfiniteQueryOptions(chatId).queryFn as unknown as (context: {
    pageParam: undefined;
    signal?: AbortSignal;
  }) => Promise<Message[]>;
  const messages = await queryFn({ pageParam: undefined });
  return messages.map((row) => row.id);
}

describe("message deletion cache behavior", () => {
  it("waits for stale message queries to cancel before removing a single deleted message from cache", async () => {
    const qc = new QueryClient();
    const before = message("before", "Before");
    const deleted = message("deleted", "Delete me");
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([before, deleted]));
    qc.setQueryData(chatKeys.messageCount("chat-1"), { count: 2 });
    let resolveCancel: () => void = () => undefined;
    vi.spyOn(qc, "cancelQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCancel = resolve;
      }),
    );
    const options = useDeleteMessageOptions(qc);

    const contextPromise = Promise.resolve(options.onMutate("deleted"));

    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0]).toEqual([before, deleted]);

    resolveCancel();
    await contextPromise;

    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0]).toEqual([before]);
    expect(qc.getQueryData(chatKeys.messageCount("chat-1"))).toEqual({ count: 1 });
  });

  it("waits for stale message queries to cancel before removing bulk-deleted messages from cache", async () => {
    const qc = new QueryClient();
    const keep = message("keep", "Keep");
    const firstDeleted = message("delete-1", "Delete 1");
    const secondDeleted = message("delete-2", "Delete 2");
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([keep, firstDeleted, secondDeleted]));
    qc.setQueryData(chatKeys.messageCount("chat-1"), { count: 3 });
    let resolveCancel: () => void = () => undefined;
    vi.spyOn(qc, "cancelQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCancel = resolve;
      }),
    );
    const options = useDeleteMessagesOptions(qc);

    const contextPromise = Promise.resolve(options.onMutate(["delete-1", "delete-2"]));

    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0]).toEqual([
      keep,
      firstDeleted,
      secondDeleted,
    ]);

    resolveCancel();
    await contextPromise;

    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0]).toEqual([keep]);
    expect(qc.getQueryData(chatKeys.messageCount("chat-1"))).toEqual({ count: 1 });
  });

  it("keeps queued deletes hidden until the server finishes them", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const keep = message("keep", "Keep");
    const first = message("first", "First");
    const second = message("second", "Second");
    qc.setQueryData(chatKeys.messages("chat-queue"), messagePages([keep, first, second]));
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    const options = useDeleteMessageOptions(qc, "chat-queue");

    await options.onMutate("first");
    await options.onMutate("second");

    // The first delete finishes while the second is still queued on the server.
    options.onSuccess({ deleted: 1 }, "first");
    options.onSettled();
    vi.advanceTimersByTime(200);
    expect(invalidate).not.toHaveBeenCalled();

    // Any list fetched now still holds the queued message; the timeline must not show it.
    storageMocks.listChatMessages.mockResolvedValue([keep, second]);
    expect(await fetchTimeline("chat-queue")).toEqual(["keep"]);

    options.onSuccess({ deleted: 1 }, "second");
    options.onSettled();
    vi.advanceTimersByTime(200);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-queue") });
  });

  it("brings a message back when its delete fails", async () => {
    const qc = new QueryClient();
    const keep = message("keep", "Keep");
    const failed = message("failed", "Failed");
    qc.setQueryData(chatKeys.messages("chat-failed"), messagePages([keep, failed]));
    const options = useDeleteMessageOptions(qc, "chat-failed");

    const context = await options.onMutate("failed");
    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-failed"))?.pages[0]).toEqual([keep]);

    options.onError(new Error("offline"), "failed", context);
    options.onSettled();

    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-failed"))?.pages[0]).toEqual([
      keep,
      failed,
    ]);
    storageMocks.listChatMessages.mockResolvedValue([keep, failed]);
    expect(await fetchTimeline("chat-failed")).toEqual(["keep", "failed"]);
  });
});
