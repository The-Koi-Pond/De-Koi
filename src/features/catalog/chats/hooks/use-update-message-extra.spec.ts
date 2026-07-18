import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { lorebookKeys } from "../../lorebooks/query-keys";
import { chatKeys } from "../query-keys";
import { useUpdateMessageExtra } from "./use-chats";

const mocks = vi.hoisted(() => ({
  currentQueryClient: null as QueryClient | null,
  toastError: vi.fn(),
  useMutation: vi.fn((options) => options),
}));

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: mocks.useMutation,
    useQueryClient: () => {
      if (!mocks.currentQueryClient) throw new Error("Missing QueryClient for test.");
      return mocks.currentQueryClient;
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { patchChatMessageExtra: vi.fn() },
}));

type MutationOptions = {
  onMutate: (variables: { messageId: string; extra: Record<string, unknown> }) => Promise<unknown>;
  onError: (error: unknown, variables: unknown, context: unknown) => void;
  onSettled: () => Promise<void>;
};

function cachedMessage(extra: Message["extra"]): Message {
  return {
    id: "message-1",
    chatId: "chat-1",
    role: "assistant",
    characterId: null,
    content: "Hello",
    activeSwipeIndex: 0,
    extra,
    createdAt: "2026-07-18T12:00:00.000Z",
  };
}

function pages(message: Message): InfiniteData<Message[]> {
  return { pages: [[message]], pageParams: [undefined] };
}

beforeEach(() => {
  mocks.currentQueryClient = null;
  mocks.toastError.mockReset();
  mocks.useMutation.mockClear();
});

describe("useUpdateMessageExtra", () => {
  it("safely optimistically updates malformed metadata, then rolls back and settles dependent queries on failure", async () => {
    const qc = new QueryClient();
    const original = pages(cachedMessage("{ malformed" as unknown as Message["extra"]));
    qc.setQueryData(chatKeys.messages("chat-1"), original);
    vi.spyOn(qc, "cancelQueries").mockResolvedValue();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    mocks.currentQueryClient = qc;
    const options = useUpdateMessageExtra("chat-1") as unknown as MutationOptions;
    const variables = {
      messageId: "message-1",
      extra: { attachments: [] },
    };

    const context = await options.onMutate(variables);
    expect(qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))?.pages[0][0]?.extra).toEqual({
      attachments: [],
    });

    options.onError(new Error("Runtime disconnected"), variables, context);
    expect(qc.getQueryData(chatKeys.messages("chat-1"))).toEqual(original);
    expect(mocks.toastError).toHaveBeenCalledWith("Runtime disconnected");

    await options.onSettled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: lorebookKeys.active("chat-1") });
  });
});
