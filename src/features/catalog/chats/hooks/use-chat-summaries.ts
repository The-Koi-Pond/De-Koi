import { useQuery } from "@tanstack/react-query";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { storageApi } from "../../../../shared/api/storage-api";
import { apiQueryRetryDelay, shouldRetryApiQuery } from "../../../../shared/api/query-retry";
import { chatKeys } from "../query-keys";

export const CHAT_SUMMARY_FIELDS = [
  "id",
  "name",
  "mode",
  "characterIds",
  "groupId",
  "personaId",
  "promptPresetId",
  "connectionId",
  "folderId",
  "sortOrder",
  "connectedChatId",
  "createdAt",
  "updatedAt",
  "metadata",
] as const;

const CHAT_SUMMARY_METADATA_FIELDS = [
  "autonomousUnreadAt",
  "autonomousUnreadCharacterIds",
  "autonomousUnreadCount",
  "branchName",
  "gameId",
  "pinned",
  "tags",
] as const;

type ChatSummaryField = Exclude<(typeof CHAT_SUMMARY_FIELDS)[number], "metadata">;
type ChatSummaryMetadataField = (typeof CHAT_SUMMARY_METADATA_FIELDS)[number];

export type ChatListItem = Pick<Chat, ChatSummaryField> & {
  metadata: Partial<Pick<Chat["metadata"], ChatSummaryMetadataField>>;
};

const CHAT_SUMMARY_WAKEUP_REFETCH_INTERVAL_MS = 5_000;
export const CHAT_SUMMARY_SESSION_STALE_TIME_MS = 5 * 60_000;
const CHAT_SUMMARY_SESSION_GC_TIME_MS = 30 * 60_000;

const CHAT_SUMMARY_SESSION_QUERY_POLICY = {
  staleTime: CHAT_SUMMARY_SESSION_STALE_TIME_MS,
  gcTime: CHAT_SUMMARY_SESSION_GC_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

function chatSummaryWakeupRefetchInterval(error: unknown): number | false {
  return shouldRetryApiQuery(0, error, { maxRetries: 1 }) ? CHAT_SUMMARY_WAKEUP_REFETCH_INTERVAL_MS : false;
}

export function useChatSummaries() {
  return useQuery({
    queryKey: chatKeys.summaries(),
    queryFn: () =>
      storageApi.list<ChatListItem>("chats", {
        fields: [...CHAT_SUMMARY_FIELDS],
        fieldSelections: { metadata: [...CHAT_SUMMARY_METADATA_FIELDS] },
      }),
    ...CHAT_SUMMARY_SESSION_QUERY_POLICY,
    refetchInterval: (query) =>
      query.state.status === "error" ? chatSummaryWakeupRefetchInterval(query.state.error) : false,
    retry: (failureCount, error) => shouldRetryApiQuery(failureCount, error, { maxRetries: 10 }),
    retryDelay: (attempt, error) => apiQueryRetryDelay(attempt, error, { baseDelayMs: 750, maxDelayMs: 5_000 }),
  });
}

export function useRecentChatSummaries(limit = 3) {
  return useQuery({
    queryKey: chatKeys.recentSummaries(limit),
    queryFn: () =>
      storageApi.list<ChatListItem>("chats", {
        fields: [...CHAT_SUMMARY_FIELDS],
        fieldSelections: { metadata: [...CHAT_SUMMARY_METADATA_FIELDS] },
        orderBy: "updatedAt",
        descending: true,
        limit,
      }),
    ...CHAT_SUMMARY_SESSION_QUERY_POLICY,
    refetchInterval: (query) =>
      query.state.status === "error" ? chatSummaryWakeupRefetchInterval(query.state.error) : false,
    retry: (failureCount, error) => shouldRetryApiQuery(failureCount, error, { maxRetries: 10 }),
    retryDelay: (attempt, error) => apiQueryRetryDelay(attempt, error, { baseDelayMs: 750, maxDelayMs: 5_000 }),
  });
}
