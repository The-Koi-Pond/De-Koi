import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { Chat, Message } from "../../../engine/contracts/types/chat";
import { ApiError } from "../../../shared/api/api-errors";
import { storageApi } from "../../../shared/api/storage-api";
import { CHAT_SUMMARY_FIELDS } from "./lib/chat-summary-projection";
import { preserveRecentMessageContentEdit } from "./lib/recent-message-content-edits";
import { sanitizeTimelineMessage, timelineMessageProjection } from "./lib/timeline-message";
import { chatKeys } from "./query-keys";

export const DEFAULT_CHAT_MESSAGE_PAGE_SIZE = 20;

export function chatDetailQueryOptions(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.detail(chatId),
    queryFn: () =>
      storageApi.get<Chat>("chats", chatId, { fields: [...CHAT_SUMMARY_FIELDS] }).then((chat) => {
        if (!chat) throw new ApiError("Chat not found", 404);
        return chat;
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function chatMessagesInfiniteQueryOptions(
  chatId: string,
  pageSize: number = DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
) {
  return infiniteQueryOptions({
    queryKey: chatKeys.messages(chatId),
    queryFn: ({ pageParam, signal }) => {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return storageApi
        .listChatMessages<Message>(chatId, {
          ...timelineMessageProjection({
            ...(pageSize > 0 ? { limit: pageSize } : {}),
            ...(pageParam ? { before: pageParam } : {}),
          }),
        })
        .then((messages) =>
          messages.map((message) => preserveRecentMessageContentEdit(chatId, sanitizeTimelineMessage(message))),
        );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (pageSize <= 0 || lastPage.length < pageSize) return undefined;
      const oldestLoaded = lastPage[0];
      if (!oldestLoaded) return undefined;
      const createdAt = String(oldestLoaded.createdAt ?? "");
      const id = String(oldestLoaded.id ?? "");
      return id ? `${createdAt}|${id}` : createdAt;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
