import { useState, type ReactNode } from "react";
import { Check, Compass, Loader2, RefreshCw, Square, X } from "lucide-react";
import type { FanficPlanProposal } from "../../../../engine/modes/fanfic/plan";
import { cn } from "../../../../shared/lib/utils";
import type { FanficPlanController } from "../hooks/use-fanfic";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

function chapterRange(proposal: FanficPlanProposal): string {
  const numbers = proposal.chapters.map((chapter) => chapter.number);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? `chapter ${first}` : `chapters ${first}–${last}`;
}

/**
 * The living outline: after a chapter, the rest of the plan re-planned from what was written (or, past the outline,
 * beats for the next chapter), shown against the old plan so the requester can use it, keep the old one, or steer.
 */
export function FanficPlanPanel({
  proposal,
  controller,
  busy,
  onUse,
  helperNote,
}: {
  proposal: FanficPlanProposal | null;
  controller: FanficPlanController;
  busy: boolean;
  /** Uses the suggestion: replaces the outline's remaining chapters, or (past the outline) fills the next chapter's notes. */
  onUse: (proposal: FanficPlanProposal) => Promise<void>;
  /** Where this helper last ran for this fic, and why (Helper Models). */
  helperNote?: ReactNode;
}) {
  const [steer, setSteer] = useState("");
  const [using, setUsing] = useState(false);
  const changed = proposal?.chapters.filter((chapter) => chapter.changed) ?? [];
  const kept = proposal?.chapters.filter((chapter) => !chapter.changed) ?? [];
  const next = proposal?.mode === "next";

  const use = async () => {
    if (!proposal) return;
    setUsing(true);
    try {
      await onUse(proposal);
    } finally {
      setUsing(false);
    }
  };

  return (
    <section
      aria-label="Plan ahead"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
            <Compass size="0.95rem" aria-hidden="true" />
            {!proposal
              ? "Plan ahead"
              : next
                ? `An idea for ${chapterRange(proposal)}`
                : changed.length > 0
                  ? `The plan for ${chapterRange(proposal)}, updated from what's written`
                  : `The plan for ${chapterRange(proposal)} still fits`}
          </h3>
          {proposal?.note && (
            <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">{proposal.note}</p>
          )}
          {!proposal && (
            <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
              Re-plan the chapters still to come from what the story actually did, with an optional nudge.
            </p>
          )}
          {helperNote}
        </div>
        {proposal && !controller.running && (
          <button
            type="button"
            onClick={() => void controller.dismiss()}
            aria-label="Dismiss the suggestion"
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <X size="0.9rem" aria-hidden="true" />
          </button>
        )}
      </div>

      {proposal && changed.length > 0 && (
        <ol className="flex flex-col gap-2">
          {changed.map((chapter) => (
            <li key={chapter.number} className="rounded-lg border border-[var(--border)] p-2.5 text-xs leading-relaxed">
              <p className="font-semibold text-[var(--foreground)]">
                Chapter {chapter.number}: {chapter.title}
              </p>
              <p className="mt-0.5 text-[var(--foreground)]/90">{chapter.summary}</p>
              {chapter.previous && (
                <p className="mt-1 text-[var(--muted-foreground)]">
                  <span className="font-semibold">Was:</span> {chapter.previous.title}. {chapter.previous.summary}
                </p>
              )}
              {chapter.reason && (
                <p className="mt-1 text-[var(--muted-foreground)]">
                  <span className="font-semibold">Why:</span> {chapter.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {proposal && kept.length > 0 && changed.length > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Unchanged: {kept.map((chapter) => `chapter ${chapter.number}`).join(", ")}.
        </p>
      )}

      {proposal && changed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FanficButton tone="primary" disabled={busy || using || controller.running} onClick={() => void use()}>
            {using ? (
              <Loader2 size="0.85rem" className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size="0.85rem" aria-hidden="true" />
            )}
            {next ? `Use as notes for chapter ${proposal.chapters[0]?.number}` : "Use the new plan"}
          </FanficButton>
          <FanficButton disabled={using || controller.running} onClick={() => void controller.dismiss()}>
            {next ? "Not this" : "Keep the old plan"}
          </FanficButton>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fanfic-plan-steer" className="text-xs text-[var(--muted-foreground)]">
          Steer the rest of the story (optional)
        </label>
        <textarea
          id="fanfic-plan-steer"
          rows={2}
          className={cn(fanficInputClass, "resize-y text-[0.8125rem]")}
          value={steer}
          onChange={(event) => setSteer(event.target.value)}
          placeholder="Bring Pierrot back in before the end, and let it get worse before it gets better."
        />
        <div className="flex flex-wrap items-center gap-2">
          {controller.running ? (
            <>
              <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
                <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
                Re-planning from what's written…
              </p>
              <FanficButton onClick={controller.stop}>
                <Square size="0.8rem" aria-hidden="true" />
                Stop
              </FanficButton>
            </>
          ) : (
            <FanficButton disabled={busy || using} onClick={() => controller.propose({ steer })}>
              <RefreshCw size="0.85rem" aria-hidden="true" />
              {steer.trim() ? "Re-plan with this nudge" : proposal ? "Re-plan again" : "Re-plan the rest"}
            </FanficButton>
          )}
        </div>
      </div>
    </section>
  );
}
