import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface PresenceEntry<T> {
  key: string;
  item: T;
  /** The item has left `items` and is playing its exit animation. */
  exiting: boolean;
}

interface LeavingEntry<T> {
  key: string;
  item: T;
  /** Where it was when it left, and the key that followed it (null if last). */
  index: number;
  before: string | null;
  /** When this item's own exit is over (Date.now() clock). */
  until: number;
}

function exitDuration<T>(exitMs: number | ((item: T) => number), item: T): number {
  // With reduced motion the exit animation is skipped by CSS, so do not hold
  // the leaving item (or, in "wait" mode, the next one) for its duration.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  return typeof exitMs === "function" ? exitMs(item) : exitMs;
}

/**
 * Keeps items mounted for an exit animation after they leave `items`.
 *
 * In `"sync"` mode a leaving item stays at its old position while new items
 * appear at once. In `"wait"` mode new items appear only after every leaving
 * item has finished, which suits step-by-step views that swap one panel for
 * another. Pair `exiting` with the `motion-exit` class and `exitMs` with its
 * duration; pass a function when items leave with different durations.
 */
export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number | ((item: T) => number),
  mode: "sync" | "wait" = "sync",
): PresenceEntry<T>[] {
  const keys = items.map(keyOf);
  const signature = keys.join("\u0000");
  const [tracked, setTracked] = useState<{ signature: string; leaving: LeavingEntry<T>[] }>({
    signature,
    leaving: [],
  });
  // The items as last rendered, so a leaving item exits showing the data it
  // last had, even if that changed after its key first appeared.
  const committedItems = useRef(items);
  useLayoutEffect(() => {
    committedItems.current = items;
  });

  // Adjusting state while rendering, so a swapped-in item never mounts before
  // the leaving one is recorded.
  if (tracked.signature !== signature) {
    const current = new Set(keys);
    const now = Date.now();
    const shown = committedItems.current;
    const departed = shown.flatMap((item, index) => {
      const key = keyOf(item);
      const next = shown[index + 1];
      return current.has(key)
        ? []
        : [
            {
              key,
              item,
              index,
              before: next === undefined ? null : keyOf(next),
              until: now + exitDuration(exitMs, item),
            },
          ];
    });
    const leaving = [...tracked.leaving.filter((entry) => !current.has(entry.key)), ...departed];
    setTracked({ signature, leaving });
  }

  // Each leaving item is released at its own deadline; a later departure does
  // not extend an earlier one.
  useEffect(() => {
    if (tracked.leaving.length === 0) return;
    const nextDeadline = Math.min(...tracked.leaving.map((entry) => entry.until));
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setTracked((state) => ({ ...state, leaving: state.leaving.filter((entry) => entry.until > now) }));
      },
      Math.max(0, nextDeadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [tracked.leaving]);

  const leaving = tracked.leaving.map(({ key, item }) => ({ key, item, exiting: true }));
  if (mode === "wait" && leaving.length > 0) return leaving;

  // Each leaving item goes back in front of the item that followed it, or to
  // its old position when that item is gone. Newest departures go in first, so
  // an older one can find a neighbour that has itself started leaving since.
  const entries: PresenceEntry<T>[] = items.map((item, index) => ({ key: keys[index], item, exiting: false }));
  for (const { key, item, index, before } of [...tracked.leaving].reverse()) {
    const anchor = before === null ? -1 : entries.findIndex((entry) => entry.key === before);
    entries.splice(anchor >= 0 ? anchor : Math.min(index, entries.length), 0, { key, item, exiting: true });
  }
  return entries;
}
