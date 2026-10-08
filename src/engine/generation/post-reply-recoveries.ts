export interface PostReplyRecovery {
  chatId: string;
  /** The reply whose helpers were re-run after its tab closed. */
  messageId: string;
  /** Card Evolution proposals the recovered run stored for review. */
  pendingCardReviews: number;
}

type PostReplyRecoveryListener = (recovery: PostReplyRecovery) => void;

const recoveryListeners = new Set<PostReplyRecoveryListener>();

/** Told, in this tab, whenever it finished re-running a reply's helpers from storage. */
export function subscribePostReplyRecoveries(listener: PostReplyRecoveryListener): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

/** Call once everything the recovered run writes is stored, so observers reading storage find it. */
export function publishPostReplyRecovery(recovery: PostReplyRecovery): void {
  for (const listener of recoveryListeners) {
    try {
      listener(recovery);
    } catch {
      // UI observers cannot affect what the recovery already stored.
    }
  }
}
