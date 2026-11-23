import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../../../shared/lib/utils";

/**
 * The frame both dialogs share (decision 3: a modal dialog named by its title, with a named close button), rendered
 * into `document.body` over a dimmed, blurred backdrop. Escape anywhere, the backdrop and the X close it.
 */
export function DialogShell({
  title,
  icon,
  onClose,
  panelClassName,
  children,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  panelClassName: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const titleId = useId();
  // Subscribed again after every render, so with several dialogs open Escape closes them in the order they last
  // re-rendered (the one typed in most recently closes last), as recorded; each sees its latest close handler.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const heading = (
    <h3 id={titleId} className="text-sm font-semibold">
      {title}
    </h3>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex w-full flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50",
          panelClassName,
        )}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          {icon ? (
            <div className="flex items-center gap-2">
              {icon}
              {heading}
            </div>
          ) : (
            heading
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
