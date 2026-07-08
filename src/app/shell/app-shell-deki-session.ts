export type DekiSessionSelectAction = "select" | "open-active" | "ignore-pending";

export function getDekiSessionSelectAction({
  sessionId,
  activeSessionId,
  dekiOpen,
  pendingSessionId,
}: {
  sessionId: string;
  activeSessionId: string | null;
  dekiOpen: boolean;
  pendingSessionId: string | null;
}): DekiSessionSelectAction {
  if (pendingSessionId === sessionId) return "ignore-pending";
  if (dekiOpen && activeSessionId === sessionId) return "open-active";
  return "select";
}

export function shouldRequestDekiSessionSelect(input: Parameters<typeof getDekiSessionSelectAction>[0]) {
  return getDekiSessionSelectAction(input) === "select";
}
