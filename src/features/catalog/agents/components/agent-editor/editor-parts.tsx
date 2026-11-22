import { ToggleLeft, ToggleRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../shared/lib/utils";

/** Secondary background, 0.75rem corners, a 1px border-colored ring and a 2px ring on focus, 0.875rem text. */
export const FIELD =
  "w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

/** Tiny muted text under a control (normal line height). */
export const NOTE = "text-[0.625rem] text-[var(--muted-foreground)]";

/** The small label above a number box or a pair of text boxes. */
export const SMALL_LABEL = "mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]";

/** The plain label above a dropdown inside a group. */
export const FIELD_LABEL = "mb-1 block text-xs text-[var(--muted-foreground)]";

interface FieldGroupProps {
  icon: LucideIcon;
  label: string;
  help?: string;
  /** The id of the control the title names (decision 2). */
  htmlFor?: string;
  /** Replaces the primary icon color. */
  iconClassName?: string;
  children: ReactNode;
}

/** One body group: a small icon, a semibold label, its help tooltip, then the controls. */
export function FieldGroup({ icon: Icon, label, help, htmlFor, iconClassName, children }: FieldGroupProps) {
  const Title = htmlFor ? "label" : "h3";
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon size="0.875rem" className={cn("shrink-0", iconClassName ?? "text-[var(--primary)]")} aria-hidden="true" />
        <Title htmlFor={htmlFor} className="text-xs font-semibold text-[var(--foreground)]">
          {label}
        </Title>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </section>
  );
}

/** The on/off icon drawn on toggles. */
export function ToggleIcon({ on, size, onClassName }: { on: boolean; size: string; onClassName?: string }) {
  const Icon = on ? ToggleRight : ToggleLeft;
  return <Icon size={size} aria-hidden="true" className={cn("shrink-0", on && (onClassName ?? "text-emerald-400"))} />;
}

interface ToggleCardProps {
  on: boolean;
  title: string;
  description: string;
  onToggle: () => void;
  disabled?: boolean;
}

/** A full-width on/off card (Agent Status, Turn Data Access, Lorebook Writer). Tinted primary when on. */
export function ToggleCard({ on, title, description, onToggle, disabled }: ToggleCardProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition-all disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "bg-[var(--primary)]/10 text-[var(--foreground)] ring-[var(--primary)]"
          : "text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)] disabled:hover:bg-transparent",
      )}
    >
      <ToggleIcon on={on} size="1rem" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="mt-1 block text-[0.625rem] leading-tight">{description}</span>
      </span>
    </button>
  );
}

interface SettingToggleProps {
  on: boolean;
  title: string;
  description: string;
  onToggle: () => void;
  /** Full width (Background Image Generation) instead of content width (Add as Prompt Section). */
  wide?: boolean;
}

/** A larger on/off button on the secondary background. */
export function SettingToggle({ on, title, description, onToggle, wide }: SettingToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-3 rounded-xl bg-[var(--secondary)] px-4 py-3 text-left ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)]",
        wide ? "w-full" : "w-fit max-w-full",
      )}
    >
      <ToggleIcon on={on} size="1.25rem" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{title}</span>
        <span className="block text-[0.625rem] text-[var(--muted-foreground)]">{description}</span>
      </span>
    </button>
  );
}

/** A number box with its unit after it. */
export function UnitInput({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {children}
      <span className="shrink-0 text-[0.6875rem] text-[var(--muted-foreground)]">{unit}</span>
    </div>
  );
}
