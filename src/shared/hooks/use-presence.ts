import { useEffect, useState } from "react";

export interface PresenceEntry<T> {
  key: string;
  item: T;
  /** The item has left `items` and is playing its exit animation. */
  exiting: boolean;
}

interface LeavingEntry<T> {
  key: string;
  item: T;
  index: number;
}

/**
 * Keeps items mounted for an exit animation after they leave `items`.
 *
 * In `"sync"` mode a leaving item stays at its old position while new items
 * appear at once. In `"wait"` mode new items appear only after every leaving
 * item has finished, which suits step-by-step views that swap one panel for
 * another. Pair `exiting` with the `motion-exit` class and `exitMs` with its
 * duration.
 */
export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number,
  mode: "sync" | "wait" = "sync",
): PresenceEntry<T>[] {
  const keys = items.map(keyOf);
  const signature = keys.join("\u0000");
  const [tracked, setTracked] = useState<{ signature: string; items: readonly T[]; leaving: LeavingEntry<T>[] }>({
    signature,
    items,
    leaving: [],
  });

  // Adjusting state while rendering, so a swapped-in item never mounts before
  // the leaving one is recorded.
  if (tracked.signature !== signature) {
    const current = new Set(keys);
    const departed = tracked.items.flatMap((item, index) => {
      const key = keyOf(item);
      return current.has(key) ? [] : [{ key, item, index }];
    });
    const leaving = [...tracked.leaving.filter((entry) => !current.has(entry.key)), ...departed];
    setTracked({ signature, items, leaving });
  }

  useEffect(() => {
    if (tracked.leaving.length === 0) return;
    const done = new Set(tracked.leaving.map((entry) => entry.key));
    // With reduced motion the exit animation is skipped by CSS, so do not hold
    // the leaving item (or, in "wait" mode, the next one) for its duration.
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = window.setTimeout(
      () => {
        setTracked((state) => ({ ...state, leaving: state.leaving.filter((entry) => !done.has(entry.key)) }));
      },
      reducedMotion ? 0 : exitMs,
    );
    return () => window.clearTimeout(timer);
  }, [exitMs, tracked.leaving]);

  const leaving = tracked.leaving.map(({ key, item, index }) => ({ key, item, index, exiting: true }));
  if (mode === "wait" && leaving.length > 0) return leaving.map(({ index: _index, ...entry }) => entry);

  const entries: PresenceEntry<T>[] = items.map((item, index) => ({ key: keys[index], item, exiting: false }));
  for (const { index, ...entry } of [...leaving].sort((a, b) => a.index - b.index)) {
    entries.splice(Math.min(index, entries.length), 0, entry);
  }
  return entries;
}
