import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../shared/lib/utils";

/** Secondary background, 1px border-color ring, 2px ring on focus. Rounding and size come from the caller. */
export const FIELD_SURFACE =
  "bg-[var(--secondary)] ring-1 placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2";
export const FIELD_RING = "ring-[var(--border)] focus:ring-[var(--ring)]";

/** The orange "selected" look shared by flags, places, scope rows and modes. */
export function optionTone(selected: boolean): string {
  return selected
    ? "bg-orange-400/15 text-orange-400 ring-orange-400/50"
    : "text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]";
}

interface FieldGroupProps {
  icon: LucideIcon;
  label: string;
  help: string;
  children: ReactNode;
  className?: string;
}

export function FieldGroup({ icon: Icon, label, help, children, className }: FieldGroupProps) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Icon size="0.875rem" className="shrink-0 text-orange-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--foreground)]">{label}</h3>
        <HelpTooltip text={help} />
      </div>
      {children}
    </section>
  );
}
