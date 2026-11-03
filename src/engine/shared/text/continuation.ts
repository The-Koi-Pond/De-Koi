/**
 * Text continued from where it stopped: one space at the seam only when neither side has whitespace there, so two
 * words never run together; nothing else changes.
 */
export function joinContinuation(previous: string, addition: string): string {
  if (!previous || !addition) return previous + addition;
  return /\s$/.test(previous) || /^\s/.test(addition) ? previous + addition : `${previous} ${addition}`;
}
