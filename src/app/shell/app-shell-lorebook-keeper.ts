import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { subscribeLorebookKeeperSettlements } from "../../engine/generation/lorebook-keeper-settlements";
import { useChatStore } from "../../shared/stores/chat.store";

// Loaded on first use, so the shell's first screen doesn't carry the Keeper's lorebook code.
const keeperReviews = () => import("../../features/catalog/lorebooks");

function warnReviewLoadFailure(error: unknown): void {
  console.warn("[lorebook-keeper] could not load the proposals waiting for review", error);
}

/**
 * Keeper runs settle in the engine (applied, or stored for review) wherever they run. In this tab,
 * refresh what they wrote and offer the open chat's new proposals for review.
 */
export function subscribeLorebookKeeperSettlementEffects(queryClient: QueryClient): () => void {
  return subscribeLorebookKeeperSettlements(({ chatId, applied, pending, lorebookIds }) => {
    if (applied > 0) {
      void keeperReviews().then(({ invalidateLorebookKeeperWrites }) =>
        invalidateLorebookKeeperWrites(queryClient, lorebookIds),
      );
      toast.success(`Lorebook Keeper applied ${applied} ${applied === 1 ? "update" : "updates"}.`);
    }
    if (pending > 0 && useChatStore.getState().activeChatId === chatId) {
      void keeperReviews()
        .then(({ showPendingLorebookKeeperReviews }) => showPendingLorebookKeeperReviews(chatId))
        .catch(warnReviewLoadFailure);
    }
  });
}

/** Offer a chat's undecided Keeper proposals when it opens, including ones made while no tab was open. */
export function showLorebookKeeperReviewsForOpenedChat(chatId: string | null): void {
  if (!chatId) return;
  void keeperReviews()
    .then(({ showPendingLorebookKeeperReviews }) => showPendingLorebookKeeperReviews(chatId))
    .catch(warnReviewLoadFailure);
}
