type EmptyNewChatCandidate = {
  activeChatId: string | null;
  setupChatId: string | null;
  chatCharIds: string[];
  totalMessageCount: number;
  messagesLoaded: boolean;
};

export function isEmptyNewChatSetup({
  activeChatId,
  setupChatId,
  chatCharIds,
  totalMessageCount,
  messagesLoaded,
}: EmptyNewChatCandidate): boolean {
  return (
    Boolean(activeChatId) &&
    setupChatId === activeChatId &&
    chatCharIds.length === 0 &&
    (!messagesLoaded || totalMessageCount === 0)
  );
}

type AbandonedDraftCandidate = Omit<EmptyNewChatCandidate, "activeChatId"> & {
  activeChatId: string | null;
  wizardOpen: boolean;
};

/**
 * A draft chat left before setup finished (cancelled, reloaded, or opened later): no characters and
 * no messages, and not currently in a setup flow. These get a "Continue setup" card.
 */
export function isAbandonedChatDraft({
  activeChatId,
  setupChatId,
  chatCharIds,
  totalMessageCount,
  messagesLoaded,
  wizardOpen,
}: AbandonedDraftCandidate): boolean {
  return (
    Boolean(activeChatId) &&
    !wizardOpen &&
    setupChatId !== activeChatId &&
    chatCharIds.length === 0 &&
    messagesLoaded &&
    totalMessageCount === 0
  );
}
