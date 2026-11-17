/**
 * How long a reply waits for the embedding behind meaning-based memory search, counted from when the turn's
 * embedding starts. On the Pi, NanoGPT embeddings took 618 ms at the median and 1.35 s at p95 (53 calls,
 * 2026-11-17), with spikes to 2.6 s. Past this point the reply goes ahead with keyword matches alone.
 */
export const SEMANTIC_RECALL_WAIT_MS = 1_200;

/**
 * Resolves with `work` if it settles by `deadlineAt` (epoch ms), otherwise with `late()`. Work that has already
 * settled wins even when the deadline has passed. With no deadline it simply waits. `work` keeps running either way,
 * so a late embedding still fills the caches for capture and the next turn.
 */
export function settleByDeadline<T>(
  work: Promise<T>,
  deadlineAt: number | null | undefined,
  late: () => T,
): Promise<T> {
  if (deadlineAt == null) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late()), Math.max(0, deadlineAt - Date.now()));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
