import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { lorebookKeys } from "../../lorebooks/query-keys";
import { chatKeys } from "../query-keys";
import { useCreateMessage } from "./use-chats";

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

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    createChatMessage: vi.fn(),
  },
}));

type CreateMessageOptions = {
  onMutate: (data: { role: string; content: string }) => unknown | Promise<unknown>;
  onError: (error: unknown, data: { role: string; content: string }, context: unknown) => void;
  onSuccess: (created: Message | null, data: { role: string; content: string }, context: unknown) => void;
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

function useCreateMessageOptions(qc: QueryClient): CreateMessageOptions {
  reactQueryMocks.currentQueryClient = qc;
  return useCreateMessage("chat-1") as unknown as CreateMessageOptions;
}

beforeEach(() => {
  reactQueryMocks.currentQueryClient = null;
  reactQueryMocks.useMutation.mockClear();
});

describe("useCreateMessage cache behavior", () => {
  it("cancels an in-flight message query before publishing the optimistic user row", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([message("existing", "Before")]));
    const cancelQueries = vi.spyOn(qc, "cancelQueries").mockResolvedValue(undefined);
    const options = useCreateMessageOptions(qc);

    await options.onMutate({ role: "user", content: "Hello" });

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-1"), exact: true });
    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0]?.at(-1)?.content).toBe(
      "Hello",
    );
  });

  it("adds an optimistic message and increments the loaded message count", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([message("existing", "Before")]));
    qc.setQueryData(chatKeys.messageCount("chat-1"), { count: 1 });
    const options = useCreateMessageOptions(qc);

    await options.onMutate({ role: "user", content: "Hello" });

    const cached = qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"));
    expect(cached?.pages[0]?.map((row) => row.content)).toEqual(["Before", "Hello"]);
    expect(qc.getQueryData(chatKeys.messageCount("chat-1"))).toEqual({ count: 2 });
  });

  it("replaces the optimistic message with the saved row without refetching active messages", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([message("existing", "Before")]));
    qc.setQueryData(chatKeys.messageCount("chat-1"), { count: 1 });
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    const options = useCreateMessageOptions(qc);

    const context = await options.onMutate({ role: "user", content: "Hello" });
    options.onSuccess(message("saved", "Saved"), { role: "user", content: "Hello" }, context);

    const cached = qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"));
    expect(cached?.pages[0]).toEqual([message("existing", "Before"), message("saved", "Saved")]);
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-1") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: chatKeys.messageCount("chat-1") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: lorebookKeys.active("chat-1") });
  });

  it("refreshes active messages when create returns no saved row to reconcile from storage", async () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages("chat-1"), messagePages([message("existing", "Before")]));
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    const options = useCreateMessageOptions(qc);

    const context = await options.onMutate({ role: "user", content: "Hello" });
    options.onSuccess(null, { role: "user", content: "Hello" }, context);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-1") });
  });

  it("restores the previous messages and count when create fails", async () => {
    const qc = new QueryClient();
    const previousMessages = messagePages([message("existing", "Before")]);
    qc.setQueryData(chatKeys.messages("chat-1"), previousMessages);
    qc.setQueryData(chatKeys.messageCount("chat-1"), { count: 1 });
    const options = useCreateMessageOptions(qc);

    const context = await options.onMutate({ role: "user", content: "Hello" });
    options.onError(new Error("nope"), { role: "user", content: "Hello" }, context);

    expect(qc.getQueryData(chatKeys.messages("chat-1"))).toEqual(previousMessages);
    expect(qc.getQueryData(chatKeys.messageCount("chat-1"))).toEqual({ count: 1 });
  });
});
