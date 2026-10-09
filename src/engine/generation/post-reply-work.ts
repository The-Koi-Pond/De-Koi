import type { StorageGateway } from "../capabilities/storage";

/**
 * Post-reply helper work still writing what the next turn reads (the tracker snapshot and agent runs),
 * per chat, in this client. Send unlocks as soon as a reply is saved, so a quick second send would
 * otherwise read the trackers from before the first reply's helpers finished.
 */
const inFlight = new WeakMap<StorageGateway, Map<string, Set<Promise<void>>>>();

/** Mark helper work for `chatId` as running; call the returned function (any number of times) when it ends. */
export function trackPostReplyWork(storage: StorageGateway, chatId: string): () => void {
  const chats = inFlight.get(storage) ?? new Map<string, Set<Promise<void>>>();
  inFlight.set(storage, chats);
  const running = chats.get(chatId) ?? new Set<Promise<void>>();
  chats.set(chatId, running);
  let finish!: () => void;
  const work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  running.add(work);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    running.delete(work);
    if (running.size === 0 && chats.get(chatId) === running) chats.delete(chatId);
    finish();
  };
}

export function postReplyWorkRunning(storage: StorageGateway, chatId: string): boolean {
  return (inFlight.get(storage)?.get(chatId)?.size ?? 0) > 0;
}

/**
 * Wait for the chat's running helper work, at most `timeoutMs`. Resolves `"finished"` when it all ended,
 * `"timed-out"` when the limit came first (the caller goes ahead anyway); rejects if `signal` aborts.
 */
export async function waitForPostReplyWork(
  storage: StorageGateway,
  chatId: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<"finished" | "timed-out"> {
  const running = [...(inFlight.get(storage)?.get(chatId) ?? [])];
  if (running.length === 0) return "finished";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.all(running).then(() => "finished" as const),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), options.timeoutMs);
      }),
      new Promise<never>((_, reject) => {
        if (!options.signal) return;
        onAbort = () => reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}
