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
 * An empty chat outside any setup flow: no characters and no messages. Usually a draft whose setup
 * was left early (cancelled or reloaded). These get a "Continue setup" card; resuming never deletes.
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
