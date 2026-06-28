import { resolveConversationStatusMessagesEnabled } from "../../../../../engine/modes/chat/status/conversation-status-settings";

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveConversationStatusDisplay(
  extensions: Record<string, unknown>,
  chatMeta: Record<string, unknown>,
  statusMessagesEnabledByDefault = false,
): {
  conversationStatusMessage?: string;
  conversationActivity?: string;
} {
  if (!resolveConversationStatusMessagesEnabled(chatMeta, statusMessagesEnabledByDefault)) {
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
