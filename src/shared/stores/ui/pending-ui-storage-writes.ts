// The UI store saves to localStorage on a short delay. Anything that is about to lose localStorage
// (a test environment being torn down) flushes the waiting save first instead of leaving a timer behind.
const flushes = new Set<() => void>();

export function trackPendingUiStorageFlush(flush: () => void): void {
  flushes.add(flush);
}

export function flushPendingUiStorageWrites(): void {
  for (const flush of flushes) flush();
}
