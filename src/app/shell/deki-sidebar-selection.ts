export function toggleDekiSessionSelection(current: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(current);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

export function getSelectedDekiSessionIds(
  selectedSessionIds: ReadonlySet<string>,
  orderedSessionIds: readonly string[],
): string[] {
  return orderedSessionIds.filter((sessionId) => selectedSessionIds.has(sessionId));
}

export function getDekiBatchDeleteCopy(count: number): { title: string; message: string } {
  const plural = count === 1 ? "" : "s";
  return {
    title: `Delete Deki Chat${plural}`,
    message: `Delete ${count} Deki chat${plural}?`,
  };
}
