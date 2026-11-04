// ──────────────────────────────────────────────
// ContextMenu — small portal-rendered right-click menu
// ──────────────────────────────────────────────
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { useEscapeOverlay } from "../../hooks/use-escape-overlay";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface ContextMenuProps {
  /** Page-relative coordinates (e.clientX / e.clientY) where the menu should anchor. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

function enabledItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')) : [];
}

/**
 * Right-click menu anchored at (x, y). Auto-flips when it would clip the viewport. Takes focus while open:
 * arrow keys, Home and End move between items; Escape, Tab, a pick or a click outside close it.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Flip / clamp the menu so it always stays inside the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - rect.width - 4;
    if (top + rect.height > window.innerHeight - 4) top = window.innerHeight - rect.height - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    setPos({ left, top });
  }, [x, y]);

  useEscapeOverlay(() => {
    onClose();
    return true;
  });

  // Keyboard access: focus the first item on open, and hand focus back to where it was on close
  // (unless something else has taken it by then).
  useEffect(() => {
    const menu = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    enabledItems(menu)[0]?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const focusMovedElsewhere = active && active !== document.body && !menu?.contains(active);
      if (previous?.isConnected && !focusMovedElsewhere) previous.focus({ preventScroll: true });
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      // Let Tab move on from the element that opened the menu.
      onClose();
      return;
    }
    if (event.key === "Escape") {
      // Handled here so the keypress doesn't also reach the parents' handlers through the portal.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const items = enabledItems(ref.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus({ preventScroll: true });
  };

  // Close on outside click, scroll, or window resize.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };

    const raf = requestAnimationFrame(() => {
      document.addEventListener("mousedown", onDown);
      window.addEventListener("scroll", onClose, true);
      window.addEventListener("resize", onClose);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }}
      className="min-w-[12rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl animate-fade-in-up"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
            item.disabled
              ? "cursor-not-allowed text-[var(--muted-foreground)] opacity-50"
              : item.destructive
                ? "text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                : "text-[var(--foreground)] hover:bg-[var(--accent)]",
          )}
        >
          {item.icon && <span className="shrink-0 text-[var(--muted-foreground)]">{item.icon}</span>}
          <span className="flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
