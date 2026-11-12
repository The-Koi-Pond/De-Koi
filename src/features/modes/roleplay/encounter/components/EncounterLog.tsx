import { useEffect, useRef, useState } from "react";
import type { EncounterLogKind } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { cn } from "../../../../../shared/lib/utils";
import type { EncounterLogEntry } from "../../../../../shared/stores/roleplay-encounter.store";

const LINE_DELAY_MS = 350;

const KIND_CLASSES: Record<EncounterLogKind, string> = {
  system: "text-[var(--muted-foreground)] italic",
  player: "text-sky-800 dark:text-sky-300 font-medium",
  enemy: "text-red-800 dark:text-red-400",
  ally: "text-emerald-800 dark:text-emerald-400",
  narration: "text-[var(--foreground)]",
};

/**
 * Lines already in the log when the overlay mounts show at once, so coming back to a fight shows its whole log;
 * new turn lines then appear one at a time. The player's own line never waits.
 */
function useRevealedCount(log: EncounterLogEntry[]): number {
  const [revealed, setRevealed] = useState(log.length);
  const next = log[revealed];
  useEffect(() => {
    if (!next) return;
    const timer = window.setTimeout(
      () => setRevealed((count) => count + 1),
      next.kind === "player" ? 0 : LINE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [next]);
  return Math.min(revealed, log.length);
}

export function EncounterLog({ log }: { log: EncounterLogEntry[] }) {
  const revealed = useRevealedCount(log);
  const listRef = useRef<HTMLOListElement>(null);
  const shownOnce = useRef(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    // On a small screen the log can sit below the cards, out of view: bring each new line into view there too.
    // Not on first show, so reopening a fight starts at the top with the cards.
    if (shownOnce.current) list.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    shownOnce.current = true;
  }, [revealed]);

  return (
    <ol
      ref={listRef}
      role="log"
      aria-label="Combat log"
      className="min-h-32 flex-1 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)]/60 p-2 text-xs leading-relaxed"
    >
      {log.slice(0, revealed).map((line) => (
        <li key={line.id} className={cn("motion-enter", KIND_CLASSES[line.kind])}>
          {line.text}
        </li>
      ))}
    </ol>
  );
}
