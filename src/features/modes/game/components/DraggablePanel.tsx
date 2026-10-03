// ──────────────────────────────────────────────
// Game: Lock + drag helpers for HUD panels
//
// Each panel (widget cards, map) uses `useDraggablePanel`
// to persist a lock flag and {x,y} offset. State is scoped
// by chatId so positions don't bleed across games.
// `PanelLockButton` renders the lock toggle in headers.
// ──────────────────────────────────────────────
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from "react";
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

// Movement before a press becomes a drag, so taps on header buttons still click.
const DRAG_THRESHOLD_PX = 3;

function offsetTransform(offset: { x: number; y: number }): string {
  return `translate3d(${offset.x}px, ${offset.y}px, 0)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// The browser still fires a click after a drag ends on the element it started
// on. Swallow that one click so dropping a panel never toggles its header.
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/**
 * Lock state, drag handling and offset for a draggable HUD panel, persisted
 * per chat so positions don't bleed across games. Reads from localStorage
 * synchronously on first render to avoid a hydration-flicker where a moved
 * panel paints at origin before snapping back.
 *
 * While unlocked, a press that moves past a few pixels drags the panel, kept
 * inside `constraintsRef` when given. The offset is written to the element's
 * transform directly during a drag and saved when it ends.
 */
export function useDraggablePanel(scopeId: string, panelId: string, constraintsRef?: RefObject<HTMLElement | null>) {
  const key = storageKey(scopeId, panelId);

  // Synchronous first-render hydration via a ref-captured seed.
  const seedRef = useRef<PanelState | null>(null);
  if (seedRef.current === null) {
    seedRef.current = readPanelState(key);
  }
  const seed = seedRef.current;

  const [locked, setLocked] = useState(seed.locked);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: seed.x, y: seed.y });

  const setOffset = useCallback((x: number, y: number) => {
    offsetRef.current = { x, y };
    if (panelRef.current) panelRef.current.style.transform = offsetTransform(offsetRef.current);
  }, []);

  const currentState = useCallback(
    (nextLocked = locked): PanelState => {
      const rect = panelRef.current?.getBoundingClientRect();
      return {
        locked: nextLocked,
        x: offsetRef.current.x,
        y: offsetRef.current.y,
        ...(rect ? { left: rect.left, top: rect.top } : {}),
      };
    },
    [locked],
  );

  const restoreViewportAnchor = useCallback(() => {
    const stored = readPanelState(key);
    if (!Number.isFinite(stored.left) || !Number.isFinite(stored.top)) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (stored.left as number) - rect.left;
    const dy = (stored.top as number) - rect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    setOffset(offsetRef.current.x + dx, offsetRef.current.y + dy);
  }, [key, setOffset]);

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

  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      const element = panelRef.current;
      if (locked || !element || event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0))
        return;

      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...offsetRef.current };
      let bounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
      let dragging = false;
      let restoreUserSelect = "";

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          restoreUserSelect = document.body.style.userSelect;
          document.body.style.userSelect = "none";
          const rect = element.getBoundingClientRect();
          const area = constraintsRef?.current?.getBoundingClientRect();
          if (area) {
            bounds = {
              minX: origin.x + area.left - rect.left,
              maxX: origin.x + area.right - rect.right,
              minY: origin.y + area.top - rect.top,
              maxY: origin.y + area.bottom - rect.bottom,
            };
          }
        }
        moveEvent.preventDefault();
        const x = origin.x + dx;
        const y = origin.y + dy;
        setOffset(bounds ? clamp(x, bounds.minX, bounds.maxX) : x, bounds ? clamp(y, bounds.minY, bounds.maxY) : y);
      };
      const onEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== event.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        if (!dragging) return;
        document.body.style.userSelect = restoreUserSelect;
        if (endEvent.type === "pointerup") swallowNextClick();
        writePanelState(key, currentState());
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [constraintsRef, currentState, key, locked, setOffset],
  );

  // Listen natively on the panel, as framer-motion's drag did: header controls
  // stop React pointerdown propagation for their own reasons, and a press on
  // them must still be able to drag. A callback ref attaches the listener
  // whenever the panel element mounts, including after an early-return render.
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelElement(node);
  }, []);

  useEffect(() => {
    if (!panelElement) return;
    panelElement.addEventListener("pointerdown", handlePointerDown);
    return () => panelElement.removeEventListener("pointerdown", handlePointerDown);
  }, [handlePointerDown, panelElement]);

  // An unlocked panel owns its gestures: touch must not scroll the page, and
  // text or images inside must not start the browser's own drag, which would
  // cancel the pointer stream mid-move.
  const dragProps = {
    onDragStart: locked ? undefined : (event: ReactDragEvent<HTMLElement>) => event.preventDefault(),
    draggable: locked ? undefined : false,
    style: {
      transform: offsetTransform(offsetRef.current),
      ...(locked
        ? {}
        : { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }),
    } satisfies CSSProperties,
  };

  return { locked, toggleLocked, panelRef: attachPanel, dragProps };
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
