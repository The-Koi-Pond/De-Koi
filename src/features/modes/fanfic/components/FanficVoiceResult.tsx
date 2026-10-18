import { Loader2, MessageSquareQuote, Square, Wand2, X } from "lucide-react";
import {
  FANFIC_VOICE_BREAK_LABELS,
  type FanficChapterVoiceCheck,
  type FanficVoiceCheckPhase,
  type FanficVoiceIssue,
} from "../../../../engine/modes/fanfic/voice-check";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { FanficButton } from "./fanfic-ui";

const PHASE_LABELS: Record<FanficVoiceCheckPhase, string> = {
  checking: "Reading every line against the voice sheets…",
  verifying: "Double-checking the lines it found…",
};

export function FanficVoiceProgress({ phase, onStop }: { phase: FanficVoiceCheckPhase | null; onStop: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3 text-[0.8125rem]"
    >
      <Loader2 size="0.9rem" className="animate-spin" aria-hidden="true" />
      <span className="text-[var(--foreground)]">{phase ? PHASE_LABELS[phase] : "Starting the voice check…"}</span>
      <FanficButton onClick={onStop} className="ml-auto">
        <Square size="0.8rem" aria-hidden="true" />
        Stop
      </FanficButton>
    </div>
  );
}

/** Notes for a full rewrite, for a line whose fix is more than a sentence or two. */
function rewriteNotes(issue: FanficVoiceIssue): string {
  return `Put ${issue.character} back in character and change nothing else. This line: "${issue.quote}". ${issue.explanation} Their voice sheet: ${issue.sheetPoint}`;
}

/**
 * The result of a chapter's voice check: each out-of-character line, the part of the sheet it breaks, and how the
 * character would say it instead. Fixes save a new version.
 */
export function FanficVoiceResult({
  check,
  chapterText,
  busy,
  onFix,
  onRewrite,
  onDismiss,
}: {
  check: FanficChapterVoiceCheck;
  /** The chapter as it reads now, heading stripped. */
  chapterText: string;
  busy: boolean;
  onFix: (issues: FanficVoiceIssue[]) => void;
  onRewrite: (notes: string) => void;
  onDismiss: () => void;
}) {
  const stale = fanficChapterTextKey(chapterText) !== check.textKey;
  const fixable = check.issues.filter((issue) => issue.fix);
  const notCounted = [
    check.ungrounded ? `${check.ungrounded} quoted text that isn't in the chapter` : "",
    check.rejected ? `${check.rejected} the double-check ruled out` : "",
    check.merged ? `${check.merged} ${check.merged === 1 ? "repeat" : "repeats"}` : "",
  ].filter(Boolean);
  const count = check.issues.length;
  return (
    <section
      aria-label="Voice check"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">
          <MessageSquareQuote size="0.9rem" className="mr-1 inline" aria-hidden="true" />
          {count === 0
            ? "Everyone sounds like themselves in this chapter."
            : `${count} out-of-character ${count === 1 ? "line" : "lines"}`}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close voice check"
          className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X size="0.9rem" aria-hidden="true" />
        </button>
      </div>
      {stale && (
        <p className="text-xs text-[var(--muted-foreground)]">
          The chapter changed since this check, so the fixes are off. Check it again to see where it stands.
        </p>
      )}
      {count > 0 && (
        <ol className="flex flex-col gap-2">
          {check.issues.map((issue, index) => (
            <li
              key={`${issue.quote}-${index}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5 text-xs leading-relaxed"
            >
              <p className="font-semibold text-[var(--foreground)]">
                {issue.character} · {FANFIC_VOICE_BREAK_LABELS[issue.kind]}
              </p>
              <p className="mt-1 text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">Line:</span> “{issue.quote}”
              </p>
              {issue.sheetPoint && (
                <p className="text-[var(--muted-foreground)]">
                  <span className="font-semibold text-[var(--foreground)]">Their sheet:</span> {issue.sheetPoint}
                </p>
              )}
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
                <FanficButton className="mt-2" disabled={busy || stale} onClick={() => onRewrite(rewriteNotes(issue))}>
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
      {count > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Fixes change only the quoted line and save a new version, so the current one is one tap back.
        </p>
      )}
      {notCounted.length > 0 && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">Not counted: {notCounted.join(", ")}.</p>
      )}
    </section>
  );
}
