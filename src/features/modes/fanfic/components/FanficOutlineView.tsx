import { useState } from "react";
import { ArrowLeft, Loader2, PenLine, RefreshCw } from "lucide-react";
import type { FanficOutline } from "../../../../engine/contracts/types/fanfic";
import { cn } from "../../../../shared/lib/utils";
import { FanficButton, FanficSection, fanficInputClass } from "./fanfic-ui";

export function FanficPlanning({
  error,
  onRetry,
  onCancel,
  onEditRequest,
}: {
  error: string | null;
  onRetry: () => void;
  onCancel: () => void;
  onEditRequest: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
      {error ? (
        <>
          <div role="alert" className="w-full rounded-xl border border-red-400/35 bg-red-500/10 p-4 text-sm">
            <p className="font-semibold text-[var(--foreground)]">The outline didn't come back.</p>
            <p className="mt-1 break-words text-[var(--muted-foreground)]">{error}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <FanficButton tone="primary" onClick={onRetry}>
              <RefreshCw size="0.9rem" aria-hidden="true" />
              Try again
            </FanficButton>
            <FanficButton onClick={onEditRequest}>
              <ArrowLeft size="0.9rem" aria-hidden="true" />
              Edit request
            </FanficButton>
          </div>
        </>
      ) : (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
          <Loader2 size="1.75rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
          <p className="text-base font-semibold text-[var(--foreground)]">Planning your fic…</p>
          <p className="text-sm text-[var(--muted-foreground)]">Working out the title, summary, and chapter beats.</p>
          <FanficButton onClick={onCancel} className="mt-2">
            Cancel
          </FanficButton>
        </div>
      )}
    </div>
  );
}

/** Enough rows to show the beats without scrolling at desktop width; resizable either way. */
function textRows(text: string, charsPerRow: number): number {
  return Math.min(10, Math.max(2, Math.ceil(text.length / charsPerRow) + 1));
}

export function FanficOutlineReview({
  outline,
  saving,
  onApprove,
  onReplan,
  onEditRequest,
}: {
  outline: FanficOutline;
  saving: boolean;
  onApprove: (outline: FanficOutline) => void;
  onReplan: () => void;
  onEditRequest: () => void;
}) {
  const [draft, setDraft] = useState<FanficOutline>(outline);
  const updateChapter = (index: number, patch: { title?: string; summary?: string }) =>
    setDraft((current) => ({
      ...current,
      chapters: current.chapters.map((chapter, chapterIndex) =>
        chapterIndex === index ? { ...chapter, ...patch } : chapter,
      ),
    }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-8">
      <header className="px-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Outline</p>
        <h2 className="mt-0.5 text-xl font-bold text-[var(--foreground)]">Here's the plan</h2>
        <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
          Change anything you like. Chapters follow these beats, so this is the place to steer.
        </p>
      </header>

      <FanficSection title="Title & summary">
        <label className="sr-only" htmlFor="fanfic-outline-title">
          Title
        </label>
        <input
          id="fanfic-outline-title"
          className={cn(fanficInputClass, "text-base font-semibold")}
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
        <label className="sr-only" htmlFor="fanfic-outline-summary">
          Summary
        </label>
        <textarea
          id="fanfic-outline-summary"
          rows={textRows(draft.summary, 80)}
          className={cn(fanficInputClass, "resize-y leading-relaxed")}
          value={draft.summary}
          onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
        />
      </FanficSection>

      <ol className="flex flex-col gap-2">
        {draft.chapters.map((chapter, index) => (
          <li key={chapter.number} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-[0.6875rem] font-bold text-[var(--muted-foreground)]">
                Ch. {chapter.number}
              </span>
              <label className="sr-only" htmlFor={`fanfic-outline-chapter-${chapter.number}`}>
                Chapter {chapter.number} title
              </label>
              <input
                id={`fanfic-outline-chapter-${chapter.number}`}
                className={cn(fanficInputClass, "py-1.5 font-semibold")}
                value={chapter.title}
                onChange={(event) => updateChapter(index, { title: event.target.value })}
              />
            </div>
            <label className="sr-only" htmlFor={`fanfic-outline-chapter-${chapter.number}-summary`}>
              Chapter {chapter.number} beats
            </label>
            <textarea
              id={`fanfic-outline-chapter-${chapter.number}-summary`}
              rows={textRows(chapter.summary, 95)}
              className={cn(fanficInputClass, "mt-2 resize-y text-[0.8125rem] leading-relaxed")}
              value={chapter.summary}
              onChange={(event) => updateChapter(index, { summary: event.target.value })}
            />
          </li>
        ))}
      </ol>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/95 to-transparent px-1 pb-1 pt-4">
        <FanficButton onClick={onEditRequest} disabled={saving}>
          <ArrowLeft size="0.9rem" aria-hidden="true" />
          Edit request
        </FanficButton>
        <FanficButton onClick={onReplan} disabled={saving}>
          <RefreshCw size="0.9rem" aria-hidden="true" />
          Re-plan
        </FanficButton>
        <FanficButton tone="primary" onClick={() => onApprove(draft)} disabled={saving} className="min-h-11 px-5">
          {saving ? (
            <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
          ) : (
            <PenLine size="1rem" aria-hidden="true" />
          )}
          Start writing
        </FanficButton>
      </div>
    </div>
  );
}
