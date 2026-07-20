// ──────────────────────────────────────────────
// Reusable animated modal shell
// Uses CSS animations instead of framer-motion to
// avoid double-animation under React.StrictMode.
// ──────────────────────────────────────────────
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useEscapeOverlay } from "../../hooks/use-escape-overlay";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Width class, e.g. "max-w-md", "max-w-lg" */
  width?: string;
  onExited?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, width = "max-w-md", onExited }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Track mounted state separately so we can play the exit animation
  // before actually removing the DOM nodes.
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState<"enter" | "exit" | null>(null);
  const enterRafRef = useRef<number | null>(null);
  const exitHandledRef = useRef(false);

  useEffect(() => {
    if (enterRafRef.current !== null) {
      cancelAnimationFrame(enterRafRef.current);
      enterRafRef.current = null;
    }

    if (open) {
      setMounted(true);
      exitHandledRef.current = false;
      // Start enter animation on next frame so the DOM is present
      enterRafRef.current = requestAnimationFrame(() => {
        setAnimating("enter");
      });
    } else if (mounted) {
      exitHandledRef.current = false;
      setAnimating("exit");
    }

    return () => {
      if (enterRafRef.current !== null) {
        cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = null;
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscapeOverlay(() => {
    onClose();
    return true;
  }, open);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }

    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }, [open]);

  useEffect(() => {
    if (open && mounted) closeButtonRef.current?.focus();
  }, [mounted, open]);

  useEffect(
    () => () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    },
    [],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusableElements = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements.at(-1);
    if (!firstFocusable || !lastFocusable) return;

    const activeElement = document.activeElement;
    if (!panel.contains(activeElement)) {
      event.preventDefault();
      firstFocusable.focus();
    } else if (event.shiftKey && activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus();
    } else if (!event.shiftKey && activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus();
    }
  };

  // Remove from DOM after exit animation completes
  const handleAnimationEnd = () => {
    if (animating === "exit" && !exitHandledRef.current) {
      exitHandledRef.current = true;
      setMounted(false);
      setAnimating(null);
      onExited?.();
    }
  };

  if (!mounted) return null;

  const isEntering = animating === "enter";

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-component="Modal"
      className="mari-modal fixed inset-0 z-50 flex items-center justify-center p-3 max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
      style={{
        opacity: isEntering ? 1 : 0,
        transition: "opacity 150ms ease-out",
      }}
      onTransitionEnd={handleAnimationEnd}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="mari-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{
          opacity: isEntering ? 1 : 0,
          transition: "opacity 150ms ease-out",
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`mari-modal-panel relative flex w-full max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] ${width} max-h-[calc(100dvh-1.5rem)] shadow-2xl shadow-black/50 sm:max-h-[min(90dvh,52rem)]`}
        style={{
          opacity: isEntering ? 1 : 0,
          transform: isEntering ? "scale(1) translateY(0)" : "scale(0.97) translateY(6px)",
          transition: "opacity 150ms ease-out, transform 150ms ease-out",
        }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--border)]/30 px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--foreground)]">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="de-koi-icon-target rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
          >
            <X size="1rem" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
