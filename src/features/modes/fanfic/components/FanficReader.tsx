import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Headphones,
  ListOrdered,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { useDeleteMessage, useSetActiveSwipe, useUpdateMessage } from "../../../catalog/chats/index";
import { GenerationFailureNotice } from "../../../runtime/generation/index";
import type { FanficState } from "../../../../engine/contracts/types/fanfic";
import {
  buildFanficAiIsmCleanupNotes,
  detectFanficAiIsms,
  fanficAiIsmNeedsCleanup,
} from "../../../../engine/modes/fanfic/ai-isms";
import { fanficChapterTitle, fanficPlannedChapterCount } from "../../../../engine/modes/fanfic/chapters";
import { buildFanficExport, type FanficExportFormat } from "../../../../engine/modes/fanfic/export";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import { FANFIC_RATING_LABELS, FANFIC_WARNING_LABELS } from "../../../../engine/modes/fanfic/request";
import { saveTextFileToUserSelectedLocation } from "../../../../shared/api/file-save-api";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { applyInlineMarkdown } from "../../../../shared/lib/markdown";
import { cn } from "../../../../shared/lib/utils";
import type { FanficChapterView, FanficWriteArgs } from "../hooks/use-fanfic";
import { useFanficNarration, type FanficNarrationStatus } from "../hooks/use-fanfic-narration";
import {
  buildFanficNarration,
  FANFIC_SCENE_BREAK,
  fanficProseBlocks,
  type FanficNarrationPlan,
} from "../lib/narration";
import { FanficButton, FanficChip, fanficInputClass } from "./fanfic-ui";

type ReaderView = number | "all";

interface FanficReaderProps {
  chatId: string;
  chatName: string;
  state: FanficState;
  chapters: FanficChapterView[];
  generating: boolean;
  streamText: string;
  phase: string | null;
  regeneratingMessageId: string | null;
  onWrite: (args: FanficWriteArgs) => void;
  onRetry: () => void;
  onStop: () => void;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function chapterHeading(state: FanficState, number: number): string {
  const title = fanficChapterTitle(state, number);
  return `Chapter ${number}${title ? `: ${title}` : ""}`;
}

function isPartlyOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function isFullyOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

/**
 * Book-style prose: real paragraphs, inline emphasis, centered scene breaks.
 * `activeBlock` highlights the paragraph being read aloud; the page follows it while the reader is following along.
 */
function Prose({ text, keyBase, activeBlock = null }: { text: string; keyBase: string; activeBlock?: number | null }) {
  const blocks = useMemo(() => fanficProseBlocks(text), [text]);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActive = useRef<Element | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (activeBlock === null || !container) {
      previousActive.current = null;
      return;
    }
    const element = container.querySelector(`[data-block="${activeBlock}"]`);
    if (!element) return;
    const following = previousActive.current ? isPartlyOnScreen(previousActive.current) : true;
    if (following && !isFullyOnScreen(element)) element.scrollIntoView({ behavior: "smooth", block: "center" });
    previousActive.current = element;
  }, [activeBlock]);

  return (
    <div
      ref={containerRef}
      className="break-words text-[1rem] leading-[1.75] text-[var(--foreground)] sm:text-[1.0625rem]"
    >
      {blocks.map((block, index) =>
        FANFIC_SCENE_BREAK.test(block) ? (
          <div
            key={`${keyBase}-${index}`}
            role="separator"
            aria-label="Scene break"
            className="my-6 text-center text-sm tracking-[0.6em] text-[var(--muted-foreground)]"
          >
            * * *
          </div>
        ) : (
          <p
            key={`${keyBase}-${index}`}
            data-block={index}
            aria-current={activeBlock === index ? "true" : undefined}
            className={cn(
              "-mx-2 mb-[1.1em] rounded-md px-2 transition-colors duration-300 last:mb-0",
              activeBlock === index && "bg-[var(--primary)]/12",
            )}
          >
            {block
              .split("\n")
              .flatMap((line, lineIndex) => [
                lineIndex > 0 ? <br key={`${keyBase}-${index}-br-${lineIndex}`} /> : null,
                ...applyInlineMarkdown(line, `${keyBase}-${index}-${lineIndex}`),
              ])}
          </p>
        ),
      )}
    </div>
  );
}

function WorkHeader({
  state,
  chatName,
  chapterCount,
  totalWords,
  onExport,
  showOutline,
  onToggleOutline,
}: {
  state: FanficState;
  chatName: string;
  chapterCount: number;
  totalWords: number;
  onExport: (format: FanficExportFormat) => void;
  showOutline: boolean;
  onToggleOutline: () => void;
}) {
  const { request, outline } = state;
  const planned = fanficPlannedChapterCount(state);
  const [tagsOpen, setTagsOpen] = useState(false);
  const extraTags = [
    ...request.warnings.map((warning) => FANFIC_WARNING_LABELS[warning]),
    ...request.relationships,
    ...request.characters,
    ...request.tags,
  ];
  return (
    <header className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <FanficChip tone="rating">{FANFIC_RATING_LABELS[request.rating]}</FanficChip>
        {request.fandom && <FanficChip>{request.fandom}</FanficChip>}
        <FanficChip>
          {chapterCount}/{planned} {planned === 1 ? "chapter" : "chapters"}
        </FanficChip>
        <FanficChip>{totalWords.toLocaleString()} words</FanficChip>
      </div>
      <h2 className="mt-2 text-xl font-bold leading-tight text-[var(--foreground)] sm:text-2xl">
        {outline?.title || chatName}
      </h2>
      {outline?.summary && (
        <p className="mt-1.5 text-sm italic leading-relaxed text-[var(--foreground)]/80">{outline.summary}</p>
      )}
      {extraTags.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setTagsOpen((open) => !open)}
            aria-expanded={tagsOpen}
            className="text-xs font-semibold text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
          >
            {tagsOpen ? "Hide tags" : `Show tags (${extraTags.length})`}
          </button>
          {tagsOpen && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {extraTags.map((tag) => (
                <FanficChip key={tag}>{tag}</FanficChip>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <FanficButton onClick={onToggleOutline} aria-expanded={showOutline}>
          <ListOrdered size="0.9rem" aria-hidden="true" />
          {showOutline ? "Hide outline" : "Outline"}
        </FanficButton>
        <FanficButton onClick={() => onExport("html")} disabled={chapterCount === 0}>
          <Download size="0.9rem" aria-hidden="true" />
          Save as HTML
        </FanficButton>
        <FanficButton onClick={() => onExport("markdown")} disabled={chapterCount === 0}>
          <Download size="0.9rem" aria-hidden="true" />
          Markdown
        </FanficButton>
      </div>
      {showOutline && outline && (
        <ol className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          {outline.chapters.map((chapter) => (
            <li key={chapter.number} className="text-sm">
              <p className="font-semibold text-[var(--foreground)]">
                {chapter.number}. {chapter.title}
                {chapter.number <= chapterCount && (
                  <span className="ml-1.5 text-xs font-normal text-[var(--muted-foreground)]">written</span>
                )}
              </p>
              <p className="text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">{chapter.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </header>
  );
}

function ChapterNav({
  state,
  chapterCount,
  view,
  onChange,
}: {
  state: FanficState;
  chapterCount: number;
  view: ReaderView;
  onChange: (view: ReaderView) => void;
}) {
  if (chapterCount <= 1) return null;
  const current = view === "all" ? null : view;
  return (
    <nav aria-label="Chapters" className="flex items-center gap-2">
      <FanficButton
        aria-label="Previous chapter"
        disabled={current === null || current <= 1}
        onClick={() => current && onChange(current - 1)}
        className="px-2"
      >
        <ChevronLeft size="1rem" aria-hidden="true" />
      </FanficButton>
      <label className="sr-only" htmlFor="fanfic-chapter-select">
        Chapter
      </label>
      <select
        id="fanfic-chapter-select"
        className={cn(fanficInputClass, "min-w-0 flex-1")}
        value={String(view)}
        onChange={(event) => onChange(event.target.value === "all" ? "all" : Number(event.target.value))}
      >
        <option value="all">Entire work</option>
        {Array.from({ length: chapterCount }, (_, index) => index + 1).map((number) => (
          <option key={number} value={number}>
            {chapterHeading(state, number)}
          </option>
        ))}
      </select>
      <FanficButton
        aria-label="Next chapter"
        disabled={current === null || current >= chapterCount}
        onClick={() => current && onChange(current + 1)}
        className="px-2"
      >
        <ChevronRight size="1rem" aria-hidden="true" />
      </FanficButton>
    </nav>
  );
}

function joinWithAnd(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Flags a chapter that leans on machine-sounding habits and offers a targeted clean-up rewrite. */
function AiIsmNotice({ text, busy, onCleanUp }: { text: string; busy: boolean; onCleanUp: (notes: string) => void }) {
  const report = useMemo(() => detectFanficAiIsms(text), [text]);
  const [open, setOpen] = useState(false);
  if (!fanficAiIsmNeedsCleanup(report)) return null;
  const total = report.findings.reduce((sum, finding) => sum + finding.count, 0);
  const top = report.findings.slice(0, 3).map((finding) => lowerFirst(finding.label));
  return (
    <section
      aria-label="Prose check"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
    >
      <p className="text-[0.8125rem] font-semibold text-[var(--foreground)]">Sounds a bit AI-written</p>
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        {total} habits spotted, mostly {joinWithAnd(top)}. A clean-up keeps the story and rewrites how the sentences are
        built. It's saved as a new version, so you can flip back.
      </p>
      {open && (
        <ul className="flex flex-col gap-1.5 text-xs text-[var(--muted-foreground)]">
          {report.findings.map((finding) => (
            <li key={finding.id}>
              <span className="font-semibold text-[var(--foreground)]">
                {finding.label} ({finding.count})
              </span>
              {finding.examples.length > 0 && <span>: “{finding.examples[0]}”</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <FanficButton tone="primary" disabled={busy} onClick={() => onCleanUp(buildFanficAiIsmCleanupNotes(report))}>
          <Sparkles size="0.9rem" aria-hidden="true" />
          Clean up prose
        </FanficButton>
        <FanficButton onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Hide details" : "Show details"}
        </FanficButton>
      </div>
    </section>
  );
}

function ChapterTools({
  chatId,
  chapter,
  isLast,
  busy,
  onWrite,
}: {
  chatId: string;
  chapter: FanficChapterView;
  isLast: boolean;
  busy: boolean;
  onWrite: (args: FanficWriteArgs) => void;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "edit">("idle");
  const [notes, setNotes] = useState("");
  const [editText, setEditText] = useState("");
  const setActiveSwipe = useSetActiveSwipe(chatId);
  const updateMessage = useUpdateMessage(chatId);
  const deleteMessage = useDeleteMessage(chatId);
  const { message } = chapter;
  const versions = Math.max(1, message.swipeCount ?? 1);
  const version = Math.min(versions, (message.activeSwipeIndex ?? 0) + 1);

  const deleteChapter = async () => {
    const confirmed = await showConfirmDialog({
      title: "Delete chapter",
      message: `Delete chapter ${chapter.number}? This can't be undone.`,
      confirmLabel: "Delete chapter",
      tone: "destructive",
    });
    if (confirmed) deleteMessage.mutate(message.id);
  };

  if (mode === "edit") {
    return (
      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor={`fanfic-edit-${message.id}`}>
          Chapter text
        </label>
        <textarea
          id={`fanfic-edit-${message.id}`}
          className={cn(fanficInputClass, "min-h-[50vh] resize-y text-[0.9375rem] leading-relaxed")}
          value={editText}
          onChange={(event) => setEditText(event.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <FanficButton onClick={() => setMode("idle")}>Cancel</FanficButton>
          <FanficButton
            tone="primary"
            disabled={!editText.trim() || updateMessage.isPending}
            onClick={() =>
              updateMessage.mutate({ messageId: message.id, content: editText }, { onSuccess: () => setMode("idle") })
            }
          >
            Save text
          </FanficButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {versions > 1 && (
          <div className="flex items-center gap-1" aria-label="Chapter versions">
            <FanficButton
              aria-label="Previous version"
              className="px-2"
              disabled={busy || version <= 1}
              onClick={() => setActiveSwipe.mutate({ messageId: message.id, index: version - 2 })}
            >
              <ChevronLeft size="0.9rem" aria-hidden="true" />
            </FanficButton>
            <span className="min-w-14 text-center text-xs font-semibold text-[var(--muted-foreground)]">
              Version {version}/{versions}
            </span>
            <FanficButton
              aria-label="Next version"
              className="px-2"
              disabled={busy || version >= versions}
              onClick={() => setActiveSwipe.mutate({ messageId: message.id, index: version })}
            >
              <ChevronRight size="0.9rem" aria-hidden="true" />
            </FanficButton>
          </div>
        )}
        <FanficButton disabled={busy} onClick={() => setMode(mode === "revise" ? "idle" : "revise")}>
          <Wand2 size="0.9rem" aria-hidden="true" />
          Rewrite with notes
        </FanficButton>
        <FanficButton disabled={busy} onClick={() => onWrite({ kind: "regenerate", messageId: message.id })}>
          <RefreshCw size="0.9rem" aria-hidden="true" />
          Redo
        </FanficButton>
        <FanficButton
          disabled={busy}
          onClick={() => {
            setEditText(stripFanficChapterHeading(message.content));
            setMode("edit");
          }}
        >
          <Pencil size="0.9rem" aria-hidden="true" />
          Edit
        </FanficButton>
        {isLast && (
          <FanficButton tone="danger" disabled={busy || deleteMessage.isPending} onClick={() => void deleteChapter()}>
            <Trash2 size="0.9rem" aria-hidden="true" />
            Delete
          </FanficButton>
        )}
      </div>
      {mode === "idle" && (
        <AiIsmNotice
          text={message.content}
          busy={busy}
          onCleanUp={(cleanupNotes) => onWrite({ kind: "revise", messageId: message.id, notes: cleanupNotes })}
        />
      )}
      {mode === "revise" && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!notes.trim()) return;
            onWrite({ kind: "revise", messageId: message.id, notes });
            setNotes("");
            setMode("idle");
          }}
        >
          <label htmlFor={`fanfic-revise-${message.id}`} className="text-[0.8125rem] font-semibold">
            What should change?
          </label>
          <textarea
            id={`fanfic-revise-${message.id}`}
            className={cn(fanficInputClass, "min-h-20 resize-y")}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="More pining before the kiss. Crowley is too nice here, make him snarkier."
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            The rewrite is added as a new version, so you can flip back. Later chapters stay as they are.
          </p>
          <div className="flex justify-end gap-2">
            <FanficButton onClick={() => setMode("idle")}>Cancel</FanficButton>
            <FanficButton type="submit" tone="primary" disabled={!notes.trim()}>
              Rewrite chapter {chapter.number}
            </FanficButton>
          </div>
        </form>
      )}
    </div>
  );
}

function NarrationBar({
  plan,
  scopeLabel,
  playingLabel,
  status,
  partIndex,
  partCount,
  elevenLabs,
  disabled,
  onPlay,
  onPause,
  onResume,
  onStop,
}: {
  plan: FanficNarrationPlan;
  scopeLabel: string;
  playingLabel: string;
  status: FanficNarrationStatus;
  partIndex: number | null;
  partCount: number;
  elevenLabs: boolean;
  disabled: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  if (status === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FanficButton onClick={onPlay} disabled={disabled || Boolean(plan.problem)}>
          <Headphones size="0.9rem" aria-hidden="true" />
          Listen to {scopeLabel}
        </FanficButton>
        <span className="text-xs text-[var(--muted-foreground)]">
          {plan.problem ??
            (elevenLabs
              ? `About ${plan.characters.toLocaleString()} ElevenLabs characters the first time. Replays are free.`
              : `About ${plan.characters.toLocaleString()} characters.`)}
        </span>
      </div>
    );
  }
  const progress = partIndex === null ? "getting the voice ready…" : `part ${partIndex + 1} of ${partCount}`;
  return (
    <div
      className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--background)]/95 px-2 py-1.5 backdrop-blur"
      role="group"
      aria-label="Narration"
    >
      {status === "paused" ? (
        <FanficButton onClick={onResume} tone="primary">
          <Play size="0.9rem" aria-hidden="true" />
          Resume
        </FanficButton>
      ) : (
        <FanficButton onClick={onPause} disabled={status === "loading"}>
          <Pause size="0.9rem" aria-hidden="true" />
          Pause
        </FanficButton>
      )}
      <FanficButton onClick={onStop}>
        <Square size="0.8rem" aria-hidden="true" />
        Stop
      </FanficButton>
      <span role="status" className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        {status === "loading" && <Loader2 size="0.8rem" className="animate-spin" aria-hidden="true" />}
        Reading {playingLabel}, {progress}
      </span>
    </div>
  );
}

function StreamingChapter({
  heading,
  text,
  phase,
  onStop,
}: {
  heading: string;
  text: string;
  phase: string | null;
  onStop: () => void;
}) {
  return (
    <article aria-busy="true" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-[var(--foreground)]">{heading}</h3>
        <FanficButton onClick={onStop}>
          <Square size="0.8rem" aria-hidden="true" />
          Stop
        </FanficButton>
      </div>
      {text.trim() ? (
        <Prose text={text} keyBase="fanfic-stream" />
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 size="1rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
          {phase || "Writing…"}
        </p>
      )}
    </article>
  );
}

function NextChapterPanel({
  state,
  nextNumber,
  busy,
  onWrite,
}: {
  state: FanficState;
  nextNumber: number;
  busy: boolean;
  onWrite: (args: FanficWriteArgs) => void;
}) {
  const [notes, setNotes] = useState("");
  const planned = fanficPlannedChapterCount(state);
  const complete = nextNumber > planned;
  const title = fanficChapterTitle(state, nextNumber);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4">
      {complete ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          <span aria-hidden="true">✦ </span>Complete. All {planned} planned chapters are written.
        </p>
      ) : (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Up next: Chapter {nextNumber}
          {title ? `: ${title}` : ""}
        </p>
      )}
      <label htmlFor="fanfic-next-notes" className="mt-2 block text-xs text-[var(--muted-foreground)]">
        Notes for this chapter (optional)
      </label>
      <textarea
        id="fanfic-next-notes"
        className={cn(fanficInputClass, "mt-1 min-h-14 resize-y")}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder={complete ? "An epilogue five years later…" : "Give Aziraphale a bigger moment here."}
      />
      <div className="mt-2 flex justify-end">
        <FanficButton
          tone="primary"
          disabled={busy}
          className="min-h-11 px-5"
          onClick={() => {
            onWrite({ kind: "chapter", notes });
            setNotes("");
          }}
        >
          <BookOpen size="1rem" aria-hidden="true" />
          {complete ? "Write a bonus chapter" : `Write chapter ${nextNumber}`}
        </FanficButton>
      </div>
    </section>
  );
}

export function FanficReader({
  chatId,
  chatName,
  state,
  chapters,
  generating,
  streamText,
  phase,
  regeneratingMessageId,
  onWrite,
  onRetry,
  onStop,
}: FanficReaderProps) {
  const chapterCount = chapters.length;
  const [view, setView] = useState<ReaderView>(Math.max(1, chapterCount));
  const [showOutline, setShowOutline] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(chapterCount);
  const writingNew = generating && !regeneratingMessageId;
  const narration = useFanficNarration(chatId);
  const { stop: stopNarration } = narration;

  // Jump to a chapter as soon as it is written, and to the newest when a fic first opens.
  useEffect(() => {
    if (chapterCount > previousCount.current) setView(chapterCount);
    previousCount.current = chapterCount;
  }, [chapterCount]);

  const totalWords = useMemo(
    () => chapters.reduce((sum, chapter) => sum + wordCount(stripFanficChapterHeading(chapter.message.content)), 0),
    [chapters],
  );

  const changeView = (next: ReaderView) => {
    stopNarration();
    setView(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportFic = async (format: FanficExportFormat) => {
    const file = buildFanficExport(
      { state, chapters: chapters.map((chapter) => chapter.message.content), fallbackTitle: chatName },
      format,
    );
    try {
      const result = await saveTextFileToUserSelectedLocation({
        filename: file.filename,
        content: file.content,
        mimeType: `${file.mimeType};charset=utf-8`,
        filters: [{ name: format === "html" ? "HTML" : "Markdown", extensions: [format === "html" ? "html" : "md"] }],
      });
      if (result !== "cancelled") toast.success(`Saved ${file.filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The fic could not be saved.");
    }
  };

  const visible = useMemo(
    () => (view === "all" ? chapters : chapters.filter((chapter) => chapter.number === Math.min(view, chapterCount))),
    [chapterCount, chapters, view],
  );
  const viewingLast = view === "all" || view >= chapterCount;
  const narrationConfig = narration.config;
  const narrationPlan = useMemo(
    () =>
      narrationConfig
        ? buildFanficNarration(
            visible.map((chapter) => ({
              messageId: chapter.message.id,
              number: chapter.number,
              heading: chapterHeading(state, chapter.number),
              content: chapter.message.content,
            })),
            narrationConfig,
          )
        : null,
    [narrationConfig, state, visible],
  );
  const narratedPart = narration.currentPart;
  const narrationScope = view === "all" && chapterCount > 1 ? "the whole work" : `chapter ${visible[0]?.number ?? 1}`;

  return (
    <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 pb-10">
      <WorkHeader
        state={state}
        chatName={chatName}
        chapterCount={chapterCount}
        totalWords={totalWords}
        onExport={(format) => void exportFic(format)}
        showOutline={showOutline}
        onToggleOutline={() => setShowOutline((open) => !open)}
      />
      <div ref={topRef} className="scroll-mt-4">
        <ChapterNav state={state} chapterCount={chapterCount} view={view} onChange={changeView} />
      </div>
      {narrationPlan && chapterCount > 0 && (
        <NarrationBar
          plan={narrationPlan}
          scopeLabel={narrationScope}
          playingLabel={narration.label}
          status={narration.status}
          partIndex={narration.partIndex}
          partCount={narration.partCount}
          elevenLabs={narrationConfig?.source === "elevenlabs"}
          disabled={Boolean(regeneratingMessageId)}
          onPlay={() => narration.play(narrationPlan.parts, narrationScope)}
          onPause={narration.pause}
          onResume={narration.resume}
          onStop={stopNarration}
        />
      )}

      {chapterCount === 0 && !generating && (
        <p className="px-1 text-sm text-[var(--muted-foreground)]">
          Nothing written yet. Chapter 1 starts below whenever you're ready.
        </p>
      )}

      {visible.map((chapter) => {
        const regenerating = generating && regeneratingMessageId === chapter.message.id;
        const heading = chapterHeading(state, chapter.number);
        if (regenerating) {
          return (
            <StreamingChapter
              key={chapter.message.id}
              heading={heading}
              text={streamText}
              phase={phase}
              onStop={onStop}
            />
          );
        }
        return (
          <article
            key={chapter.message.id}
            className="flex flex-col gap-3"
            aria-labelledby={`fanfic-ch-${chapter.number}`}
          >
            <h3 id={`fanfic-ch-${chapter.number}`} className="text-lg font-bold text-[var(--foreground)]">
              {heading}
            </h3>
            <Prose
              text={chapter.message.content}
              keyBase={`fanfic-${chapter.message.id}`}
              activeBlock={narratedPart?.chapterNumber === chapter.number ? narratedPart.block : null}
            />
            <div className="border-t border-[var(--border)] pt-3">
              <ChapterTools
                chatId={chatId}
                chapter={chapter}
                isLast={chapter.number === chapterCount}
                busy={generating}
                onWrite={onWrite}
              />
            </div>
          </article>
        );
      })}

      {writingNew && (
        <StreamingChapter
          heading={chapterHeading(state, chapterCount + 1)}
          text={streamText}
          phase={phase}
          onStop={onStop}
        />
      )}

      <GenerationFailureNotice chatId={chatId} onRetry={onRetry} />

      {viewingLast && !generating && (
        <NextChapterPanel state={state} nextNumber={chapterCount + 1} busy={generating} onWrite={onWrite} />
      )}
    </div>
  );
}
