import { Loader2, RotateCcw } from "lucide-react";
import type { EncounterResult } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import type { EncounterSummaryStatus } from "../../../../../shared/stores/roleplay-encounter.store";

const RESULT_LABELS: Record<EncounterResult, { glyph: string; label: string; className: string }> = {
  victory: { glyph: "🏆", label: "Victory", className: "text-amber-800 dark:text-amber-300" },
  defeat: { glyph: "💀", label: "Defeat", className: "text-red-800 dark:text-red-400" },
  fled: { glyph: "🏃", label: "Fled", className: "text-sky-800 dark:text-sky-300" },
  interrupted: { glyph: "🚩", label: "Interrupted", className: "text-[var(--muted-foreground)]" },
};

const BUTTON_CLASS = "rounded-lg px-3 py-2 text-xs font-semibold";

/** The end screen: the result, then the summary's progress. A failed summary can be tried again (decision 6). */
export function EncounterEnd(props: {
  result: EncounterResult;
  summaryStatus: EncounterSummaryStatus;
  summaryError: string | null;
  onRetrySummary: () => void;
  onClose: () => void;
}) {
  const result = RESULT_LABELS[props.result];
  return (
    <section aria-label="Combat result" className="space-y-2 text-center">
      <p className={`text-lg font-bold uppercase tracking-widest ${result.className}`}>
        <span aria-hidden="true">{result.glyph} </span>
        {result.label}
      </p>
      {(props.summaryStatus === "idle" || props.summaryStatus === "generating") && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.8rem" className="animate-spin" aria-hidden="true" />
          Generating combat summary...
        </p>
      )}
      {props.summaryStatus === "written" && (
        <div className="space-y-2">
          <p role="status" className="text-xs text-[var(--muted-foreground)]">
            Combat summary has been added to the chat.
          </p>
          <button
            type="button"
            onClick={props.onClose}
            className={`${BUTTON_CLASS} bg-[var(--primary)] text-[var(--primary-foreground)]`}
          >
            Close combat window
          </button>
        </div>
      )}
      {props.summaryStatus === "failed" && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-red-800 dark:text-red-300">
            Failed to generate summary.
            {props.summaryError && ` ${props.summaryError}`}
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={props.onRetrySummary}
              className={`${BUTTON_CLASS} inline-flex items-center gap-1.5 bg-[var(--primary)] text-[var(--primary-foreground)]`}
            >
              <RotateCcw size="0.8rem" aria-hidden="true" />
              Try again
            </button>
            <button
              type="button"
              onClick={props.onClose}
              className={`${BUTTON_CLASS} text-[var(--muted-foreground)] hover:bg-[var(--accent)]`}
            >
              Close anyway
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
