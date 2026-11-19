import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useEscapeOverlay } from "../../../../../shared/hooks/use-escape-overlay";
import { cn } from "../../../../../shared/lib/utils";
import { BROWSER_PROVIDERS } from "../../lib/providers";
import type { BrowserProvider, ProviderId } from "../../lib/providers/types";

/** The provider button and its menu of all six sites. Escape and clicks outside close the menu. */
export function ProviderSwitcher({
  provider,
  onPick,
}: {
  provider: BrowserProvider;
  onPick: (id: ProviderId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEscapeOverlay(() => {
    setOpen(false);
    buttonRef.current?.focus();
    return true;
  }, open);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
  }, [open]);

  const moveFocus = (step: number) => {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span aria-hidden="true">{provider.icon}</span>
        <span>{provider.name}</span>
        <ChevronDown size="0.875rem" aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Sites"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(event.key === "ArrowDown" ? 1 : -1);
            }
          }}
          className="absolute left-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 shadow-lg"
        >
          {BROWSER_PROVIDERS.map((option) => {
            const current = option.id === provider.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => {
                  setOpen(false);
                  onPick(option.id);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] focus-visible:bg-[var(--accent)] focus-visible:outline-none",
                  current && "font-semibold",
                )}
              >
                <span aria-hidden="true" className="w-5 text-center">
                  {option.icon}
                </span>
                <span className="flex-1">{option.name}</span>
                {current && <Check size="0.875rem" aria-hidden="true" className="text-[var(--primary)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
