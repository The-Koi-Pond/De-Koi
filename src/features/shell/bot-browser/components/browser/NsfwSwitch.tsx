import { LogIn } from "lucide-react";
import { useId } from "react";

import { cn } from "../../../../../shared/lib/utils";
import type { BrowserProvider } from "../../lib/providers/types";

/** What the NSFW switch shows and does for one provider. */
function nsfwSwitchState(provider: BrowserProvider, nsfw: boolean, loggedIn: boolean) {
  switch (provider.nsfwMode) {
    case "free":
      return { checked: nsfw, disabled: false, dimmed: false, account: false, reason: "Toggle NSFW content" };
    case "login":
      return loggedIn
        ? {
            checked: true,
            disabled: true,
            dimmed: false,
            account: true,
            reason: "NSFW depends on your account settings",
          }
        : {
            checked: false,
            disabled: false,
            dimmed: true,
            account: false,
            reason: `Click to log in to ${provider.name} for NSFW content`,
          };
    case "sort":
      return {
        checked: false,
        disabled: false,
        dimmed: true,
        account: false,
        reason: 'Use the "Popular NSFW" sort option',
      };
    case "locked":
      return { checked: true, disabled: true, dimmed: false, account: false, reason: "DataCat is NSFW-only" };
  }
}

/**
 * The NSFW switch. Its reason is a tooltip on wide screens and written next to it on phones, so it never needs
 * hover. A sort-driven provider keeps it clickable (marked unavailable) so a click can explain where NSFW lives.
 */
export function NsfwSwitch({
  provider,
  nsfw,
  loggedIn,
  onClick,
}: {
  provider: BrowserProvider;
  nsfw: boolean;
  loggedIn: boolean;
  onClick: () => void;
}) {
  const reasonId = useId();
  const state = nsfwSwitchState(provider, nsfw, loggedIn);
  const unavailable = provider.nsfwMode === "sort";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={state.checked}
        aria-disabled={unavailable || undefined}
        aria-describedby={reasonId}
        disabled={state.disabled}
        title={state.reason}
        onClick={onClick}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          !state.disabled && "hover:bg-[var(--accent)]",
          state.dimmed && "opacity-60",
          state.disabled && "cursor-not-allowed",
        )}
      >
        {provider.nsfwMode === "login" && !loggedIn && <LogIn size="0.8125rem" aria-hidden="true" />}
        <span>NSFW{state.account ? " (account)" : ""}</span>
        <span
          aria-hidden="true"
          className={cn(
            "relative h-4 w-7 rounded-full border border-[var(--border)] transition-colors",
            state.checked ? "bg-[var(--primary)]" : "bg-[var(--muted)]",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[var(--foreground)] transition-[left]",
              state.checked ? "left-[0.8rem]" : "left-0.5",
            )}
          />
        </span>
      </button>
      <span id={reasonId} className="text-xs text-[var(--muted-foreground)] sm:sr-only">
        {state.reason}
      </span>
    </div>
  );
}
