function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveConversationStatusBlurbDisplay(
  extensions: Record<string, unknown>,
  chatMeta: Record<string, unknown>,
): {
  conversationStatusMessage?: string;
} {
  return {
    conversationStatusMessage:
      chatMeta.conversationStatusMessagesEnabled === true ? readString(extensions.conversationStatusMessage) : undefined,
  };
}
