import type { QueryClient } from "@tanstack/react-query";

import { subscribeContinuityDirectorRefreshCompletions } from "../../engine/modes/roleplay/continuity-director/continuity-director-refresh-events";
import { chatKeys } from "../../features/catalog/chats";
import { roleplayContinuityDirectorKeys } from "../../shared/api/roleplay-continuity-director-query-keys";

export async function invalidateContinuityDirectorRefreshCompletion(
  queryClient: QueryClient,
  chatId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: roleplayContinuityDirectorKeys.state(chatId) }),
    queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) }),
    queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
  ]);
}

export function subscribeContinuityDirectorRefreshCacheInvalidation(queryClient: QueryClient): () => void {
  return subscribeContinuityDirectorRefreshCompletions(({ chatId }) => {
    void invalidateContinuityDirectorRefreshCompletion(queryClient, chatId);
  });
}
