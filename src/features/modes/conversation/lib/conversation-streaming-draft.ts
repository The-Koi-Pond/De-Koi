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
    messageContent: "",
    contentParts: undefined,
    showActiveRegeneration: true,
  };
}

export function shouldShowConversationTypingIndicator(input: {
  isStreaming: boolean;
  hasDelayedCharacterInfo: boolean;
  messageStyle: string;
}) {
  return input.isStreaming && !input.hasDelayedCharacterInfo && input.messageStyle !== "bubble";
}
