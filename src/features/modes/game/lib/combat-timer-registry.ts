export type CombatTimerRegistry = {
  schedule: (callback: () => void, delayMs: number) => void;
  clearAll: () => void;
  pendingCount: () => number;
};

export function createCombatTimerRegistry(): CombatTimerRegistry {
  const timers = new Set<ReturnType<typeof setTimeout>>();

  return {
    schedule(callback, delayMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delayMs);
      timers.add(timer);
    },
    clearAll() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
    pendingCount() {
      return timers.size;
    },
  };
}
