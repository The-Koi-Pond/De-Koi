import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";

/** Secondary background with a 1px border-color ring and a ring color on focus. Width, ring size on focus,
 * rounding and text size come from the caller. */
export const FIELD_SURFACE =
  "bg-[var(--secondary)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-[var(--ring)]";

/** Tiny muted text under a control. */
export const NOTE = "text-[0.625rem] text-[var(--muted-foreground)]";

/** Inline code in a note. */
export const INLINE_CODE = "rounded bg-[var(--secondary)] px-1 py-0.5 font-mono";

interface FieldGroupProps {
  icon: LucideIcon;
  label: string;
  help?: string;
  children: ReactNode;
}

export function FieldGroup({ icon: Icon, label, help, children }: FieldGroupProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon size="0.875rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-[var(--foreground)]">{label}</h3>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </section>
  );
}
