const DISCOVER_HISTORY_KEY = "deKoiDiscover";

function historyRecord(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
}

export function openDiscoverHistory(history: History, href: string): void {
  if (historyRecord(history.state)[DISCOVER_HISTORY_KEY] === true) return;
  history.pushState({ ...historyRecord(history.state), [DISCOVER_HISTORY_KEY]: true }, "", href);
}

export function closeDiscoverHistory(history: History, href: string): void {
  const state = historyRecord(history.state);
  if (state[DISCOVER_HISTORY_KEY] !== true) return;
  delete state[DISCOVER_HISTORY_KEY];
  history.replaceState(state, "", href);
}

/**
 * A chat that becomes the open one (picked from the list, started from a character, made by setup) replaces
 * Discover, so Discover doesn't stay on top of the new chat. Opening Discover over a chat doesn't change the open
 * chat, so that doesn't close it.
 */
export function useCloseDiscoverWhenChatOpens(activeChatId: string | null, closeDiscover: () => void): void {
  useEffect(() => {
    if (!activeChatId) return;
    closeDiscover();
  }, [activeChatId, closeDiscover]);
}

export function useDiscoverHistoryLifecycle(open: boolean, onPopState: () => void): void {
  useEffect(() => {
    if (!open) return;
    openDiscoverHistory(window.history, window.location.href);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, onPopState]);
}
import { useEffect } from "react";
