import { useCallback, useEffect, useMemo } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";

import {
  chatDetailQueryOptions,
  chatKeys,
  chatMessagesInfiniteQueryOptions,
  type ChatListItem,
} from "../../features/catalog/chats/sidebar";
import { preloadModeRoute } from "../../features/modes/router/preload";
import { loadModeSurface } from "./mode-surface-loader";
import {
  createPredictiveChatPreloadController,
  scheduleIdlePredictiveChatPreloads,
  selectRecentPredictiveChats,
  type PredictiveChatCandidate,
  type PredictiveChatPreloadDependencies,
} from "./predictive-chat-preload";

const PREDICTIVE_MESSAGE_PAGE_SIZE = 20;

export function createPredictiveChatPreloadDependencies(
  queryClient: QueryClient,
): PredictiveChatPreloadDependencies {
  return {
    hasDetail: (chatId) => queryClient.getQueryData(chatKeys.detail(chatId)) !== undefined,
    hasMessages: (chatId) => queryClient.getQueryData(chatKeys.messages(chatId)) !== undefined,
    preloadSurface: loadModeSurface,
    preloadRoute: preloadModeRoute,
    prefetchDetail: (chatId) => queryClient.prefetchQuery({ ...chatDetailQueryOptions(chatId), retry: false }),
    prefetchMessages: (chatId) =>
      queryClient.prefetchInfiniteQuery({
        ...chatMessagesInfiniteQueryOptions(chatId, PREDICTIVE_MESSAGE_PAGE_SIZE),
        retry: false,
      }),
    removeDetail: (chatId) => queryClient.removeQueries({ queryKey: chatKeys.detail(chatId), exact: true }),
    removeMessages: (chatId) => queryClient.removeQueries({ queryKey: chatKeys.messages(chatId), exact: true }),
  };
}

export function usePredictiveChatPreload({
  chats,
  activeChatId,
}: {
  chats: readonly ChatListItem[];
  activeChatId: string | null;
}) {
  const queryClient = useQueryClient();
  const controller = useMemo(
    () => createPredictiveChatPreloadController(createPredictiveChatPreloadDependencies(queryClient)),
    [queryClient],
  );

  useEffect(() => controller.setActiveChatId(activeChatId), [activeChatId, controller]);

  const recentCandidates = useMemo(
    () => selectRecentPredictiveChats(chats, activeChatId),
    [activeChatId, chats],
  );
  const preload = useCallback((chat: PredictiveChatCandidate) => controller.preload(chat), [controller]);

  useEffect(
    () => scheduleIdlePredictiveChatPreloads(recentCandidates, preload),
    [preload, recentCandidates],
  );

  return useCallback((chat: PredictiveChatCandidate) => void preload(chat), [preload]);
}
