import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { chatKeys } from "../query-keys";
import { useDeleteMessage, useDeleteMessages } from "./use-chats";

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

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {},
}));

type DeleteMessageOptions = {
  onMutate: (messageId: string) => unknown;
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

function createDeleteMessageOptions(qc: QueryClient): DeleteMessageOptions {
  reactQueryMocks.currentQueryClient = qc;
  return useDeleteMessage("chat-1") as unknown as DeleteMessageOptions;
}

function createDeleteMessagesOptions(qc: QueryClient): DeleteMessagesOptions {
  reactQueryMocks.currentQueryClient = qc;
  return useDeleteMessages("chat-1") as unknown as DeleteMessagesOptions;
}

beforeEach(() => {
  reactQueryMocks.currentQueryClient = null;
  reactQueryMocks.useMutation.mockClear();
});

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
    const options = createDeleteMessageOptions(qc);

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
    const options = createDeleteMessagesOptions(qc);

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
});
