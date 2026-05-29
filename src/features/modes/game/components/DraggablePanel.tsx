// ──────────────────────────────────────────────
// Game: Lock + drag helpers for HUD panels
//
// Each panel (widget cards, map) uses `useDraggablePanel`
// to persist a lock flag and {x,y} offset. State is scoped
// by chatId so positions don't bleed across games.
// `PanelLockButton` renders the lock toggle in headers.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionValue } from "framer-motion";
import { Lock, Unlock } from "lucide-react";
import { cn } from "../../../../shared/lib/utils";

const STORAGE_PREFIX = "marinara-game-panel:";

interface PanelState {
  locked: boolean;
  x: number;
  y: number;
  left?: number;
  top?: number;
}

function storageKey(scopeId: string, panelId: string): string {
  return `${STORAGE_PREFIX}${scopeId}:${panelId}`;
}

function readPanelState(key: string): PanelState {
  if (typeof window === "undefined") return { locked: true, x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { locked: true, x: 0, y: 0 };
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      locked: parsed.locked !== false,
      x: Number.isFinite(parsed.x) ? (parsed.x as number) : 0,
      y: Number.isFinite(parsed.y) ? (parsed.y as number) : 0,
      left: Number.isFinite(parsed.left) ? (parsed.left as number) : undefined,
      top: Number.isFinite(parsed.top) ? (parsed.top as number) : undefined,
    };
  } catch {
    return { locked: true, x: 0, y: 0 };
  }
}

function writePanelState(key: string, state: PanelState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // quota / unavailable — best-effort only
  }
}

/**
 * Returns motion values + lock state for a draggable HUD panel, persisted per
 * chat so positions don't bleed across games. Reads from localStorage
 * synchronously on first render to avoid a hydration-flicker where a moved
 * panel paints at origin before snapping back.
 */
export function useDraggablePanel(scopeId: string, panelId: string) {
  const key = storageKey(scopeId, panelId);

  // Synchronous first-render hydration via a ref-captured seed.
  const seedRef = useRef<PanelState | null>(null);
  if (seedRef.current === null) {
    seedRef.current = readPanelState(key);
  }
  const seed = seedRef.current;

  const [locked, setLocked] = useState(seed.locked);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(seed.x);
  const y = useMotionValue(seed.y);

  const currentState = useCallback(
    (nextLocked = locked): PanelState => {
      const rect = panelRef.current?.getBoundingClientRect();
      return {
        locked: nextLocked,
        x: x.get(),
        y: y.get(),
        ...(rect ? { left: rect.left, top: rect.top } : {}),
      };
    },
    [locked, x, y],
  );

  const restoreViewportAnchor = useCallback(() => {
    const stored = readPanelState(key);
    if (!Number.isFinite(stored.left) || !Number.isFinite(stored.top)) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (stored.left as number) - rect.left;
    const dy = (stored.top as number) - rect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    x.set(x.get() + dx);
    y.set(y.get() + dy);
  }, [key, x, y]);

  useLayoutEffect(() => {
    restoreViewportAnchor();
  });

  useEffect(() => {
    const element = panelRef.current;
    const parent = element?.offsetParent;
    if (!parent || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(restoreViewportAnchor);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(parent);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [restoreViewportAnchor]);

  const toggleLocked = useCallback(() => {
    setLocked((prev) => {
      const next = !prev;
      writePanelState(key, currentState(next));
      return next;
    });
  }, [currentState, key]);

  const handleDragEnd = useCallback(() => {
    writePanelState(key, currentState());
  }, [currentState, key]);

  return { locked, toggleLocked, x, y, panelRef, handleDragEnd };
}

interface PanelLockButtonProps {
  locked: boolean;
  onToggle: () => void;
  /** Icon size in px. Matches the adjacent collapse indicator. */
  size?: number;
  className?: string;
}

/** Small lock toggle styled to match collapse/chevron buttons in HUD panels. */
export function PanelLockButton({ locked, onToggle, size = 10, className }: PanelLockButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={locked ? "Unlock to move" : "Lock in place"}
      aria-label={locked ? "Unlock panel" : "Lock panel"}
      aria-pressed={!locked}
      className={cn(
        "flex shrink-0 items-center justify-center text-white/30 transition-colors hover:text-white/70",
        className,
      )}
    >
      {locked ? <Lock size={size} /> : <Unlock size={size} />}
    </button>
  );
}
