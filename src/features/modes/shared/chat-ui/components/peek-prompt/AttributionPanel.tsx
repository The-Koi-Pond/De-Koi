import { cn } from "../../../../../../shared/lib/utils";
import type { PromptAttributionViewModel } from "../../lib/prompt-attribution";
import { plural } from "./format";

const MUTED = "text-[var(--muted-foreground)]";

const SOURCE_TONES = {
  exact: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  best_effort: "border-amber-500/30 bg-amber-500/10 text-amber-300",
} as const;

export function AttributionPanel({ view }: { view: PromptAttributionViewModel }) {
  const sources = view.groups.reduce((total, group) => total + group.items.length, 0);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] font-bold uppercase text-[var(--foreground)]">Context Attribution</span>
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[0.5625rem] font-bold uppercase",
            SOURCE_TONES[view.sourceTone] ?? SOURCE_TONES.best_effort,
          )}
        >
          {view.sourceLabel}
        </span>
        <span className={cn("text-[0.625rem]", MUTED)}>
          {sources} {plural(sources, "source")}
        </span>
      </div>
      <div className="space-y-2">
        {view.groups.map((group) => (
          <div
            key={group.label}
            className="rounded-md border border-[var(--border)]/50 bg-[var(--background)]/35 px-3 py-2"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={cn("text-[0.625rem] font-bold uppercase", MUTED)}>{group.label}</span>
              <span className={cn("text-[0.5625rem]", MUTED)}>{group.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((item, i) => (
                <div key={i} className="grid min-w-0 gap-1 text-[0.6875rem]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--foreground)]">{item.label}</span>
                    <span
                      className={cn("rounded bg-[var(--accent)]/60 px-1.5 py-0.5 text-[0.5625rem] uppercase", MUTED)}
                    >
                      {item.statusLabel}
                    </span>
                  </div>
                  {item.snippet == null ? (
                    <p className={cn("text-[0.625rem]", MUTED)}>Hidden source details redacted.</p>
                  ) : (
                    <p className="max-h-10 overflow-hidden leading-relaxed text-[var(--foreground)]/75">
                      {item.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
