export function resolveConversationRegenerationDisplay<TContentParts>(input: {
  isRegenerating: boolean;
  savedMessageContent: string;
  savedContentParts: TContentParts | undefined;
}) {
  if (!input.isRegenerating) {
    return {
      messageContent: input.savedMessageContent,
      contentParts: input.savedContentParts,
      showActiveRegeneration: false,
    };
  }

  return {
    messageContent: input.savedMessageContent,
    contentParts: input.savedContentParts,
    showActiveRegeneration: true,
  };
}

export function shouldShowConversationTypingIndicator(input: {
  isStreaming: boolean;
  hasDelayedCharacterInfo: boolean;
  messageStyle: string;
  activeCharacterCount?: number;
  hasSpecificTypingTarget?: boolean;
}) {
  if (!input.isStreaming || input.hasDelayedCharacterInfo || input.messageStyle === "bubble") return false;
  if ((input.activeCharacterCount ?? 1) > 1 && input.hasSpecificTypingTarget === false) return false;
  return true;
}
