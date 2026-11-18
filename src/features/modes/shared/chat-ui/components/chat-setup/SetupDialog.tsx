import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { keepTabInside } from "../../../../../../shared/lib/focus-trap";
import { motionStyle } from "../../../../../../shared/lib/motion";
import { cn } from "../../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../../shared/stores/ui.store";

const CARD_MOTION = motionStyle({ enterFrom: { y: 10, scale: 0.98 }, durationMs: 200 });
const BACKDROP_MOTION = motionStyle({ durationMs: 150 });

/**
 * The window setup shows over the chat area: a dimmed backdrop and a centered card that is a labeled modal dialog
 * (decision 8). Focus moves in when it opens and back when it closes, and Tab stays inside.
 *
 * Escape runs `onEscape` unless the key press was already handled (an app dialog over setup handles its own Escape
 * and stops it) or a dialog opened from setup, like character import, is showing. Pass no `onEscape` while setup
 * itself shows a dialog that owns Escape.
 */
export function SetupDialog({
  titleId,
  wide = false,
  initialFocusRef,
  refocusKey,
  onDismiss,
  onEscape,
  children,
}: {
  titleId: string;
  wide?: boolean;
  /** What gets focus on open; the dialog itself when not given. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When this changes (another step or card), focus returns to the dialog if it was lost with a removed control. */
  refocusKey?: string;
  onDismiss: () => void;
  onEscape?: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? dialogRef.current)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
    // Focus moves in once, when setup opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [refocusKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (useUIStore.getState().modal) return;
      const escape = onEscapeRef.current;
      if (!escape) return;
      event.preventDefault();
      escape();
    };
    // On window, so app dialogs (which handle Escape on the document and stop it) get the key first.
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div
        aria-hidden="true"
        data-setup-backdrop=""
        className="motion-enter absolute inset-0 bg-black/55 backdrop-blur-sm"
        style={BACKDROP_MOTION}
        onClick={onDismiss}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => keepTabInside(event, dialogRef.current)}
        style={CARD_MOTION}
        className={cn(
          "motion-enter relative flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-2xl shadow-black/40 outline-none",
          wide ? "max-w-lg sm:max-w-2xl" : "max-w-lg",
        )}
      >
        {children}
      </div>
    </div>
  );
}
