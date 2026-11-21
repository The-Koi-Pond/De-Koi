import { HelpTooltip } from "../HelpTooltip";

export function FieldLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
      {label}
      <HelpTooltip text={help} size="0.625rem" />
    </span>
  );
}

/** One-line fields: the number fields and the thinking tag fields. */
export const LINE_FIELD_CLASS =
  "block w-full min-w-0 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--muted-foreground)]/50 focus:ring-1 focus:ring-[var(--primary)]/40";

export const TEXT_AREA_CLASS =
  "mt-1 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs leading-relaxed text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] transition-shadow placeholder:text-[var(--muted-foreground)]/50 focus:ring-[var(--ring)]";
