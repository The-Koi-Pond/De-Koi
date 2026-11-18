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

/** "Mira is typing..." or, while the reply is being made into a voice note, "Mira is recording a voice message...". */
export function conversationTypingLabel(names: string, recordingVoiceNote: boolean) {
  const verb = names.includes(",") || names.includes(" & ") ? "are" : "is";
  return `${names} ${verb} ${recordingVoiceNote ? "recording a voice message" : "typing"}...`;
}
