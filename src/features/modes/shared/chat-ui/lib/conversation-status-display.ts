function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveConversationStatusDisplay(
  extensions: Record<string, unknown>,
  chatMeta: Record<string, unknown>,
): {
  conversationStatusMessage?: string;
  conversationActivity?: string;
} {
  if (chatMeta.conversationStatusMessagesEnabled !== true) {
    return {
      conversationStatusMessage: undefined,
      conversationActivity: undefined,
    };
  }

  return {
    conversationStatusMessage: readString(extensions.conversationStatusMessage),
    conversationActivity: readString(extensions.conversationActivity),
  };
}