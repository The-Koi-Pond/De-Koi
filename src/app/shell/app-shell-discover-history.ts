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
