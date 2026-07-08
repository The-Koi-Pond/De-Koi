export function shouldRequestDekiSessionSelect({
  sessionId,
  activeSessionId,
  dekiOpen,
  pendingSessionId,
}: {
  sessionId: string;
  activeSessionId: string | null;
  dekiOpen: boolean;
  pendingSessionId: string | null;
}) {
  if (pendingSessionId === sessionId) return false;
  return !(dekiOpen && activeSessionId === sessionId);
}
