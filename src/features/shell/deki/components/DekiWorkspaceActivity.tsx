import { AlertCircle, Check, ChevronRight, CircleSlash, Loader2, Square } from "lucide-react";
import type { DekiWorkspaceTraceItem } from "../../../../engine/deki/deki-entry";
import { cn } from "../../../../shared/lib/utils";
import { dekiTraceSteps, type DekiActivityStep, type DekiLiveActivity } from "../lib/deki-workspace-activity";

const MAX_VISIBLE_LIVE_STEPS = 6;

function StepStatusIcon({ status }: { status: DekiActivityStep["status"] }) {
  if (status === "running") {
    return <Loader2 size="0.75rem" className="shrink-0 animate-spin text-sky-400" aria-label="Running" />;
  }
  if (status === "error") {
    return <AlertCircle size="0.75rem" className="shrink-0 text-amber-500" aria-label="Failed" />;
  }
  if (status === "interrupted") {
    return <CircleSlash size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" aria-label="Interrupted" />;
  }
  return <Check size="0.75rem" className="shrink-0 text-emerald-500" aria-label="Done" />;
}

function DekiStepList({ steps }: { steps: DekiActivityStep[] }) {
  return (
    <ol className="grid gap-1">
      {steps.map((step) => (
        <li key={step.id} className="flex min-w-0 items-start gap-2">
          <span className="mt-[0.1875rem]">
            <StepStatusIcon status={step.status} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate",
                step.status === "running" ? "text-[var(--foreground)]" : "text-[var(--foreground)]/75",
              )}
              title={step.label}
            >
              {step.label}
            </span>
            {step.status === "interrupted" && (
              <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">Stopped before it finished</span>
            )}
            {step.status === "error" && step.output && (
              <span className="block truncate text-[0.6875rem] text-amber-500/90" title={step.output}>
                {step.output}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What Deki is doing right now, shown under the user's message while a turn runs. */
export function DekiLiveActivityPanel({
  activity,
  stopping,
  onStop,
}: {
  activity: DekiLiveActivity;
  stopping: boolean;
  onStop: () => void;
}) {
  const hiddenSteps = Math.max(0, activity.steps.length - MAX_VISIBLE_LIVE_STEPS);
  const visibleSteps = activity.steps.slice(hiddenSteps);
  const headline = stopping ? "Stopping..." : (activity.narration ?? "Deki-senpai is thinking...");
  return (
    <div
      className="deki-live-activity mb-3 ml-[4.5rem] mr-4 mt-1 rounded-xl border border-[var(--border)] bg-[var(--card)]/85 px-3 py-2.5 text-xs text-[var(--foreground)] shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]/90" title={headline}>
          {headline}
        </span>
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[0.6875rem] font-semibold text-[var(--foreground)]/75 transition-all hover:bg-[var(--accent)] active:scale-95 disabled:cursor-default disabled:opacity-60"
          aria-label="Stop Deki-senpai"
        >
          {stopping ? <Loader2 size="0.6875rem" className="animate-spin" /> : <Square size="0.625rem" />}
          Stop
        </button>
      </div>
      {activity.retrying && (
        <div className="mt-1.5 text-[0.6875rem] text-amber-500">Retrying after an unreadable model reply...</div>
      )}
      {visibleSteps.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)]/60 pt-2">
          {hiddenSteps > 0 && (
            <div className="mb-1 text-[0.6875rem] text-[var(--muted-foreground)]">
              {hiddenSteps} earlier step{hiddenSteps === 1 ? "" : "s"}
            </div>
          )}
          <DekiStepList steps={visibleSteps} />
        </div>
      )}
    </div>
  );
}

/** A collapsed record of the commands a finished Deki turn ran. */
export function DekiTraceDisclosure({ trace }: { trace?: DekiWorkspaceTraceItem[] }) {
  const steps = dekiTraceSteps(trace);
  if (steps.length === 0) return null;
  const failed = steps.filter((step) => step.status === "error").length;
  const interrupted = steps.filter((step) => step.status === "interrupted").length;
  return (
    <details className="deki-trace group mb-2 ml-[4.5rem] mr-4 text-xs text-[var(--muted-foreground)]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 text-[0.6875rem] font-medium transition-colors hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <ChevronRight size="0.75rem" className="transition-transform group-open:rotate-90" aria-hidden />
        Checked {steps.length} thing{steps.length === 1 ? "" : "s"}
        {failed > 0 && <span className="text-amber-500">, {failed} failed</span>}
        {interrupted > 0 && <span>, {interrupted} interrupted</span>}
      </summary>
      <div className="mt-1.5 rounded-lg border border-[var(--border)]/70 bg-[var(--card)]/60 px-3 py-2">
        <DekiStepList steps={steps} />
      </div>
    </details>
  );
}
