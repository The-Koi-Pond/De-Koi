import type { StorageGateway } from "../capabilities/storage";

const foregroundGenerationCounts = new WeakMap<StorageGateway, number>();
const deferredWorkers = new WeakMap<StorageGateway, Map<object, () => void>>();

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

export function beginForegroundGeneration(storage: StorageGateway): () => void {
  foregroundGenerationCounts.set(storage, (foregroundGenerationCounts.get(storage) ?? 0) + 1);
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
