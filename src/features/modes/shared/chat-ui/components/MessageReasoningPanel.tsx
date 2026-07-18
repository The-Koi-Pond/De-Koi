import { Brain, ChevronDown } from "lucide-react";

import { cn } from "../../../../../shared/lib/utils";

export function MessageReasoningPanel({ reasoning, className }: { reasoning: string | null; className?: string }) {
  if (!reasoning) return null;

  return (
    <details
      className={cn(
        "group/reasoning mt-2 overflow-hidden rounded-lg border border-[var(--border)]/70 bg-[var(--secondary)]/45",
        className,
      )}
      open
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[0.6875rem] font-semibold text-[var(--muted-foreground)] marker:hidden">
        <Brain size="0.75rem" aria-hidden="true" />
        <span>Model reasoning</span>
        <ChevronDown
          size="0.75rem"
          aria-hidden="true"
          className="ml-auto transition-transform group-open/reasoning:rotate-180"
        />
      </summary>
      <div className="border-t border-[var(--border)]/60 px-3 py-2 text-[0.75rem] leading-relaxed whitespace-pre-wrap text-[var(--muted-foreground)]">
        {reasoning}
      </div>
    </details>
  );
}
