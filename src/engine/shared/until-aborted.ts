function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Settles as soon as the signal aborts, even when the gateway ignores it (the app gateway's complete() can't cancel a
 * request already sent), so Stop ends the work right away and the late reply is dropped.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
