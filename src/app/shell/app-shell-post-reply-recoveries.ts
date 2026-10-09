import type { QueryClient } from "@tanstack/react-query";

import { subscribePostReplyRecoveries } from "../../engine/generation/post-reply-recoveries";
import { chatKeys } from "../../features/catalog/chats/index";
import { useChatStore } from "../../shared/stores/chat.store";

// Loaded on first use, so the shell's first screen doesn't carry the card review code.
const cardReviews = () => import("../../features/catalog/characters/card-reviews");

function warnReviewLoadFailure(error: unknown): void {
  console.warn("[card-evolution] could not load the card updates waiting for review", error);
}

// Only while that chat is still on screen: checked again once the module and the proposals have loaded.
function showCardEvolutionReviews(chatId: string): void {
  const stillOpen = () => useChatStore.getState().activeChatId === chatId;
  void cardReviews()
    .then(({ showPendingCardEvolutionReviews }) =>
      stillOpen() ? showPendingCardEvolutionReviews(chatId, stillOpen) : undefined,
    )
    .catch(warnReviewLoadFailure);
}

/**
 * A reply whose tab closed gets its helpers re-run by whichever client claims the job. When that is
 * this tab, show what the run wrote (message extras, illustrations, a generated background) and
 * offer its card updates if the chat is open.
 */
export function subscribePostReplyRecoveryEffects(queryClient: QueryClient): () => void {
  return subscribePostReplyRecoveries(({ chatId, pendingCardReviews }) => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    if (pendingCardReviews > 0 && useChatStore.getState().activeChatId === chatId) showCardEvolutionReviews(chatId);
  });
}

/** Offer a chat's undecided card updates from recovered runs when it opens. */
export function showCardEvolutionReviewsForOpenedChat(chatId: string | null): void {
  if (chatId) showCardEvolutionReviews(chatId);
}
