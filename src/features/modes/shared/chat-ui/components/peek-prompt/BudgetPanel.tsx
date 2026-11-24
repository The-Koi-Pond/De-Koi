import { Gauge, TriangleAlert } from "lucide-react";

import type { PromptBudgetEstimate } from "../../../../../../engine/generation/prompt-budget";
import { cn } from "../../../../../../shared/lib/utils";
import { formatCount } from "./format";

const MUTED = "text-[var(--muted-foreground)]";
const MAX_WARNINGS = 4;

const TONES = {
  over: { text: "text-red-300", bar: "bg-red-400" },
  near: { text: "text-amber-300", bar: "bg-amber-300" },
  fine: { text: "text-emerald-300", bar: "bg-emerald-300" },
} as const;

function clampPercent(value: number, min: number) {
  return `${Math.min(100, Math.max(min, Math.round(value)))}%`;
}

function remainingText(remaining: number | null) {
  if (remaining == null) return "unknown remaining";
  return remaining < 0 ? `${formatCount(Math.abs(remaining))} over` : `${formatCount(remaining)} left`;
}

function budgetTone(budget: PromptBudgetEstimate) {
  if (budget.remainingTokens != null && budget.remainingTokens < 0) return TONES.over;
  const nearLimit = budget.warnings.some(
    (warning) => warning.kind === "near_limit" || warning.kind === "large_section",
  );
  return nearLimit ? TONES.near : TONES.fine;
}

function Tile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-[var(--background)]/45 px-3 py-2">
      <div className={MUTED}>{label}</div>
      <div className="font-semibold">{value == null ? "Unknown" : formatCount(value)}</div>
    </div>
  );
}

function trimRiskTag(risk: string) {
  if (risk === "high") return "trim risk";
  if (risk === "medium") return "watch";
  return null;
}

export function BudgetPanel({ budget }: { budget: PromptBudgetEstimate }) {
  const tone = budgetTone(budget);
  const estimated = budget.estimatedPromptTokens;
  const limit = budget.contextLimit;
  const warnings = budget.warnings.slice(0, MAX_WARNINGS);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Gauge aria-hidden="true" className="h-3.5 w-3.5" />
          Prompt Budget
        </span>
        <span className={cn("text-[0.6875rem] font-medium", tone.text)}>{remainingText(budget.remainingTokens)}</span>
        <span className={cn("text-[0.6875rem]", MUTED)}>
          ~{formatCount(estimated)} prompt tokens / {limit == null ? "unknown" : formatCount(limit)} context
        </span>
      </div>
      {limit != null && limit > 0 && (
        <div aria-hidden="true" className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--muted)]/50">
          <div
            className={cn("h-full rounded-full transition-all", tone.bar)}
            style={{ width: clampPercent((estimated / limit) * 100, 0) }}
          />
        </div>
      )}
      <div className="mb-3 grid gap-2 text-[0.6875rem] sm:grid-cols-3">
        <Tile label="Input budget" value={budget.inputBudgetTokens} />
        <Tile label="Output reserve" value={budget.outputReserveTokens} />
        <Tile label="Safety reserve" value={budget.safetyReserveTokens} />
      </div>
      {warnings.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {warnings.map((warning, i) => (
            <div
              key={i}
              className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[0.6875rem] text-amber-200/90"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {budget.sections.map((section) => {
          const tag = trimRiskTag(section.trimRisk);
          return (
            <div key={section.kind} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[0.6875rem]">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{section.label}</span>
                  {tag && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.5625rem] text-amber-200">
                      {tag}
                    </span>
                  )}
                </div>
                <div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--muted)]/45">
                  <div
                    className="h-full rounded-full bg-[var(--foreground)]/45"
                    style={{ width: clampPercent((section.estimatedTokens / Math.max(1, estimated)) * 100, 2) }}
                  />
                </div>
              </div>
              <span className={MUTED}>~{formatCount(section.estimatedTokens)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
