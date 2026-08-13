import type { StorageGateway } from "../capabilities/storage";

const foregroundGenerationCounts = new WeakMap<StorageGateway, number>();
const deferredWorkers = new WeakMap<StorageGateway, Map<object, () => void>>();
const foregroundStartInterruptions = new WeakMap<
  StorageGateway,
  Map<object, { controller: AbortController; reason: unknown }>
>();

export function foregroundGenerationActive(storage: StorageGateway): boolean {
  return (foregroundGenerationCounts.get(storage) ?? 0) > 0;
}

export function deferUntilForegroundGenerationCompletes(
  storage: StorageGateway,
  key: object,
  callback: () => void,
): void {
  const workers = deferredWorkers.get(storage) ?? new Map<object, () => void>();
  workers.set(key, callback);
  deferredWorkers.set(storage, workers);
}

export function interruptWhenForegroundGenerationStarts(
  storage: StorageGateway,
  key: object,
  controller: AbortController,
  reason?: unknown,
): () => void {
  if (foregroundGenerationActive(storage)) {
    controller.abort(reason);
    return () => {};
  }
  const interruptions = foregroundStartInterruptions.get(storage) ?? new Map();
  const registration = { controller, reason };
  interruptions.set(key, registration);
  foregroundStartInterruptions.set(storage, interruptions);
  return () => {
    const registered = foregroundStartInterruptions.get(storage);
    if (registered?.get(key) !== registration) return;
    registered.delete(key);
    if (registered.size === 0) foregroundStartInterruptions.delete(storage);
  };
}

export function beginForegroundGeneration(storage: StorageGateway): () => void {
  const activeCount = foregroundGenerationCounts.get(storage) ?? 0;
  foregroundGenerationCounts.set(storage, activeCount + 1);
  if (activeCount === 0) {
    const interruptions = foregroundStartInterruptions.get(storage);
    foregroundStartInterruptions.delete(storage);
    for (const interruption of interruptions?.values() ?? []) {
      interruption.controller.abort(interruption.reason);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, (foregroundGenerationCounts.get(storage) ?? 1) - 1);
    if (remaining > 0) {
      foregroundGenerationCounts.set(storage, remaining);
      return;
    }
    foregroundGenerationCounts.delete(storage);
    const workers = deferredWorkers.get(storage);
    if (!workers) return;
    deferredWorkers.delete(storage);
    let firstError: unknown;
    for (const callback of workers.values()) {
      try {
        callback();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };
}
