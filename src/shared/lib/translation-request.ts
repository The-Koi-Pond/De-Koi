export type TranslationRequestResult<T> = { status: "completed"; value: T } | { status: "cancelled" };

export interface TranslationRequest<T> {
  readonly signal: AbortSignal;
  run: () => Promise<TranslationRequestResult<T>>;
  cancel: () => void;
}

export function createTranslationRequest<T>(execute: (signal: AbortSignal) => Promise<T>): TranslationRequest<T> {
  const controller = new AbortController();
  let cancelled = false;

  return {
    signal: controller.signal,
    cancel() {
      cancelled = true;
      controller.abort();
    },
    async run() {
      try {
        const value = await execute(controller.signal);
        return cancelled || controller.signal.aborted ? { status: "cancelled" } : { status: "completed", value };
      } catch (error) {
        if (cancelled || controller.signal.aborted) return { status: "cancelled" };
        throw error;
      }
    },
  };
}
