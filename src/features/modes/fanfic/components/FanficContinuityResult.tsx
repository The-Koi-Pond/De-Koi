import type { ReactNode } from "react";
import { Loader2, ShieldCheck, Square, Wand2, X } from "lucide-react";
import type {
  FanficChapterContinuityCheck,
  FanficChapterContinuityIssue,
  FanficContinuityPhase,
} from "../../../../engine/modes/fanfic/continuity";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { FANFIC_CONTINUITY_CATEGORY_LABELS, fanficIssueChapterLabel } from "../../../../engine/modes/fanfic/quality";
import { FanficButton } from "./fanfic-ui";

const PHASE_LABELS: Record<FanficContinuityPhase, string> = {
  updating_ledger: "Updating the story ledger first…",
  checking: "Reading this chapter against the ones before it…",
  verifying: "Double-checking the slips it found…",
};

export function FanficContinuityProgress({
  phase,
  onStop,
}: {
  phase: FanficContinuityPhase | null;
  onStop: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3 text-[0.8125rem]"
    >
      <Loader2 size="0.9rem" className="animate-spin" aria-hidden="true" />
      <span className="text-[var(--foreground)]">{phase ? PHASE_LABELS[phase] : "Starting the continuity check…"}</span>
      <FanficButton onClick={onStop} className="ml-auto">
        <Square size="0.8rem" aria-hidden="true" />
        Stop
      </FanficButton>
    </div>
  );
}

/** An extra reads its own write context, so it is named by its current label rather than as a range of mains. */
function earlierRange(check: FanficChapterContinuityCheck, label: string): string {
  const before = check.chapter - 1;
  const span =
    check.label !== String(check.chapter)
      ? `the chapters before chapter ${label}`
      : before === 1
        ? "chapter 1"
        : `chapters 1–${before}`;
  return check.basis === "ledger" ? `${span} (the oldest from the story ledger)` : span;
}

/** The earlier chapter's label now; null once it is deleted. */
function earlierLabel(issue: FanficChapterContinuityIssue, labels: ReadonlyMap<string, string>): string | null {
  return fanficIssueChapterLabel(labels, issue.earlierMessageId, issue.earlierChapter);
}

function earlierChapterName(issue: FanficChapterContinuityIssue, labels: ReadonlyMap<string, string>): string {
  const label = earlierLabel(issue, labels);
  return label ? `Ch ${label}:` : "A deleted chapter:";
}

/** Notes for a full rewrite, for a slip whose fix is more than a sentence or two. */
function fanficContinuityRewriteNotes(issue: FanficChapterContinuityIssue, earlier: string | null): string {
  const source = issue.earlierChapter === 0 ? "the story ledger" : earlier ? `chapter ${earlier}` : "a deleted chapter";
  return `Fix a continuity slip and change nothing else. Earlier, ${source} says: "${issue.earlierQuote}". This chapter says: "${issue.laterQuote}". ${issue.explanation} Keep the earlier fact.`;
}

/**
 * The result of a chapter's continuity check: each slip with both quotes, why they can't both be true, and the
 * smallest edit that fixes it. Fixes save a new version of the chapter.
 */
export function FanficContinuityResult({
  check,
  labels,
  chapterText,
  busy,
  onFix,
  onRewrite,
  onDismiss,
  helperNote,
}: {
  check: FanficChapterContinuityCheck;
  /** Each chapter's label in the current layout, by message id, so renumbered extras show their new number. */
  labels: ReadonlyMap<string, string>;
  /** The chapter as it reads now, heading stripped. */
  chapterText: string;
  busy: boolean;
  onFix: (issues: FanficChapterContinuityIssue[]) => void;
  onRewrite: (notes: string) => void;
  onDismiss: () => void;
  /** Where this helper last ran for this fic, and why (Helper Models). */
  helperNote?: ReactNode;
}) {
  const stale = fanficChapterTextKey(chapterText) !== check.textKey;
  const fixable = check.issues.filter((issue) => issue.fix);
  const notCounted = [
    check.ungrounded ? `${check.ungrounded} quoted text that isn't in the fic` : "",
    check.rejected ? `${check.rejected} the double-check ruled out` : "",
    check.merged ? `${check.merged} ${check.merged === 1 ? "repeat" : "repeats"}` : "",
  ].filter(Boolean);
  const range = earlierRange(check, labels.get(check.messageId) ?? check.label);
  return (
    <section
      aria-label="Continuity check"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">
          <ShieldCheck size="0.9rem" className="mr-1 inline" aria-hidden="true" />
          {check.issues.length === 0
            ? `No continuity slips against ${range}.`
            : `${check.issues.length} continuity ${check.issues.length === 1 ? "slip" : "slips"} against ${range}`}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close continuity check"
          className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X size="0.9rem" aria-hidden="true" />
        </button>
      </div>
      {helperNote}
      {stale && (
        <p className="text-xs text-[var(--muted-foreground)]">
          The chapter changed since this check, so the fixes are off. Check it again to see where it stands.
        </p>
      )}
      {check.issues.length > 0 && (
        <ol className="flex flex-col gap-2">
          {check.issues.map((issue, index) => (
            <li
              key={`${issue.laterQuote}-${index}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5 text-xs leading-relaxed"
            >
              <p className="font-semibold text-[var(--foreground)]">
                {FANFIC_CONTINUITY_CATEGORY_LABELS[issue.category]}
                {issue.subtype ? ` · ${issue.subtype}` : ""}
              </p>
              <p className="mt-1 text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">
                  {issue.earlierChapter === 0
                    ? "Story ledger:"
                    : (
                          issue.earlierMessageId
                            ? issue.earlierMessageId === check.messageId
                            : issue.earlierChapter === check.chapter
                        )
                      ? "Earlier in this chapter:"
                      : earlierChapterName(issue, labels)}
                </span>{" "}
                “{issue.earlierQuote}”
              </p>
              <p className="text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">This chapter:</span> “{issue.laterQuote}”
              </p>
              <p className="mt-1 text-[var(--foreground)]/85">{issue.explanation}</p>
              {issue.fix ? (
                <div className="mt-2 rounded-md border border-dashed border-[var(--border)] p-2">
                  <p className="text-[var(--muted-foreground)]">
                    <span className="font-semibold text-[var(--foreground)]">Change</span> “{issue.fix.find}”
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    <span className="font-semibold text-[var(--foreground)]">to</span> “{issue.fix.replace}”
                  </p>
                  <FanficButton className="mt-2" disabled={busy || stale} onClick={() => onFix([issue])}>
                    <Wand2 size="0.85rem" aria-hidden="true" />
                    Fix this
                  </FanficButton>
                </div>
              ) : (
                <FanficButton
                  className="mt-2"
                  disabled={busy || stale}
                  onClick={() => onRewrite(fanficContinuityRewriteNotes(issue, earlierLabel(issue, labels)))}
                >
                  <Wand2 size="0.85rem" aria-hidden="true" />
                  Rewrite with this note
                </FanficButton>
              )}
            </li>
          ))}
        </ol>
      )}
      {fixable.length > 1 && (
        <div>
          <FanficButton tone="primary" disabled={busy || stale} onClick={() => onFix(fixable)}>
            <Wand2 size="0.85rem" aria-hidden="true" />
            Fix all {fixable.length}
          </FanficButton>
        </div>
      )}
      {check.issues.length > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Fixes change only the quoted passage and save a new version, so the current one is one tap back.
        </p>
      )}
      {notCounted.length > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">Not counted: {notCounted.join(", ")}.</p>
      )}
    </section>
  );
}
