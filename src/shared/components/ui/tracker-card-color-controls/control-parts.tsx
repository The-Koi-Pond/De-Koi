import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

/** A tinted rounded panel holding one or two groups. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-1 rounded-lg ring-1 ring-[var(--border)]/40", className)}>
      {children}
    </div>
  );
}

export function GroupHeading({
  children,
  aside,
  compact,
}: {
  children: ReactNode;
  aside?: ReactNode;
  compact: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      {/* The text stays in its written case; CSS draws it in capitals. */}
      <p
        data-group-heading
        className={cn(
          "truncate font-semibold text-[var(--muted-foreground)] uppercase",
          compact ? "text-[0.5625rem]" : "text-[0.625rem] tracking-wider",
        )}
      >
        {children}
      </p>
      {aside !== undefined && (
        <span className="shrink-0 font-mono text-[0.5625rem] text-[var(--muted-foreground)] tabular-nums">{aside}</span>
      )}
    </div>
  );
}

/** The lightly tinted track a row of option buttons sits in. */
export function OptionTrack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5 rounded-md bg-[var(--background)]/35 p-0.5", className)}>{children}</div>
  );
}

interface OptionButtonProps {
  label: string;
  title?: string;
  /** Source and Stage buttons swap their icon for a check mark when selected. */
  icon?: LucideIcon;
  selected: boolean;
  disabled: boolean;
  compact: boolean;
  onSelect: () => void;
}

export function OptionButton({ label, title, icon: Icon, selected, disabled, compact, onSelect }: OptionButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 items-center justify-center gap-1 rounded-[5px] px-1.5 text-[0.5625rem] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed",
        compact ? "min-h-6" : "min-h-7",
        selected
          ? "bg-[var(--primary)]/12 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
          : "text-[var(--muted-foreground)] enabled:hover:bg-[var(--background)]/60 enabled:hover:text-[var(--foreground)]",
      )}
    >
      {Icon && (selected ? <Check className="size-2.5 shrink-0" /> : <Icon className="size-2.5 shrink-0" />)}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

interface RangeSliderProps {
  label: string;
  title: string;
  value: number;
  disabled: boolean;
  onValue: (value: number) => void;
}

export function RangeSlider({ label, title, value, disabled, onValue }: RangeSliderProps) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      disabled={disabled}
      aria-label={`${label}: ${title}`}
      title={title}
      onChange={(event) => onValue(Number(event.target.value))}
      className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

interface ChannelToggleProps {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}

/** A small switch over a visually hidden checkbox. */
export function ChannelToggle({ label, checked, disabled, onToggle }: ChannelToggleProps) {
  return (
    <label
      title={checked ? `Disable ${label}` : `Enable ${label}`}
      className="relative inline-flex shrink-0 cursor-pointer items-center has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55"
    >
      <input
        type="checkbox"
        aria-label={`${label} channel`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        className="peer sr-only"
      />
      <span className="h-4 w-7 rounded-full bg-[var(--background)] ring-1 ring-[var(--border)] transition-colors peer-checked:bg-[var(--primary)]/22 peer-checked:ring-[var(--primary)]/40" />
      <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-[var(--muted-foreground)] transition peer-checked:translate-x-3 peer-checked:bg-[var(--primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)]" />
    </label>
  );
}
