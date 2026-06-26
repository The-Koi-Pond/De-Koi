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
  return {
    conversationStatusMessage:
      chatMeta.conversationStatusMessagesEnabled === true ? readString(extensions.conversationStatusMessage) : undefined,
    conversationActivity: readString(extensions.conversationActivity),
  };
}
