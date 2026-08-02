import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chat, Message } from "../../../engine/contracts/types/chat";
import { chatKeys } from "./query-keys";

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  listChatMessages: vi.fn(),
}));

vi.mock("../../../shared/api/storage-api", () => ({
  storageApi: storageMocks,
}));

import { chatDetailQueryOptions, chatMessagesInfiniteQueryOptions } from "./chat-query-options";

const chat = {
  id: "chat-1",
  name: "Warm chat",
  mode: "conversation",
  characterIds: [],
  groupId: null,
  personaId: null,
  promptPresetId: null,
  connectionId: null,
  connectedChatId: null,
  folderId: null,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  metadata: {},
} as unknown as Chat;

const message = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant",
  content: "Ready",
  createdAt: "2026-08-01T00:00:01.000Z",
  extra: {},
} as Message;

describe("chat query options", () => {
  beforeEach(() => {
    storageMocks.get.mockReset();
    storageMocks.listChatMessages.mockReset();
  });

  it("prefetches chat detail into the key consumed by useChat", async () => {
    storageMocks.get.mockResolvedValue(chat);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.prefetchQuery(chatDetailQueryOptions("chat-1"));

    expect(storageMocks.get).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({ fields: expect.any(Array) }),
    );
    expect(queryClient.getQueryData(chatKeys.detail("chat-1"))).toEqual(chat);
  });

  it("prefetches the projected first 20 messages into the infinite-query shape", async () => {
    storageMocks.listChatMessages.mockResolvedValue([message]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.prefetchInfiniteQuery(chatMessagesInfiniteQueryOptions("chat-1", 20));

    expect(storageMocks.listChatMessages).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        limit: 20,
        fields: expect.arrayContaining(["id", "content", "createdAt"]),
      }),
    );
    expect(queryClient.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))).toEqual({
      pages: [[message]],
      pageParams: [undefined],
    });
  });
});
