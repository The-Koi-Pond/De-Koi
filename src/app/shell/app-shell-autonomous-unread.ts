/**
 * Decides whether opening a chat should clear its "texts you first" unread mark. Returns the key to remember once the
 * clear succeeds, or null to leave the mark alone.
 *
 * A hidden page (a backgrounded phone tab, a minimized window) still has an active chat, but nobody is reading it, so
 * it must not clear the mark: the clear runs when the page becomes visible again.
 */
export function autonomousUnreadClearKey(input: {
  activeChatId: string | null;
  isPageActive: boolean;
  isClearing: boolean;
  metadata: { autonomousUnreadCount?: unknown; autonomousUnreadAt?: unknown };
  hasLocalUnread: boolean;
  lastClearKey: string | null;
}): string | null {
  const { activeChatId, metadata } = input;
  if (!activeChatId || !input.isPageActive || input.isClearing) return null;
  const unreadCount = typeof metadata.autonomousUnreadCount === "number" ? metadata.autonomousUnreadCount : 0;
  if (unreadCount <= 0 && !input.hasLocalUnread) return null;
  const clearKey = `${activeChatId}:${unreadCount}:${metadata.autonomousUnreadAt ?? ""}`;
  return clearKey === input.lastClearKey ? null : clearKey;
}
