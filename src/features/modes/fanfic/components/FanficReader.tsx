import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toUserMessage } from "../../../../shared/lib/error-message";
import {
  Ban,
  BookMarked,
  BookOpen,
  Check,
  Compass,
  ChevronLeft,
  ChevronRight,
  Download,
  Gauge,
  MessageSquareQuote,
  PenTool,
  Headphones,
  ListOrdered,
  Search,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  StepForward,
  TextSelect,
  X,
  Trash2,
  Wand2,
} from "lucide-react";
import { useChat, useSetActiveSwipe, useUpdateMessage } from "../../../catalog/chats/index";
import { HelperRunNote } from "../../../catalog/connections/index";
import { GenerationFailureNotice } from "../../../runtime/generation/index";
import type {
  FanficState,
  FanficUnfinished,
  FanficUnfinishedReason,
  FanficVoiceSheet,
} from "../../../../engine/contracts/types/fanfic";
import {
  fanficCanonLine,
  fanficChapterLayout,
  fanficExtraPlace,
  fanficUnfinishedChapter,
  fanficUnfinishedReason,
  type FanficChapterRef,
} from "../../../../engine/modes/fanfic/chapter-refs";
import { fanficDeletePlan } from "../../../../engine/modes/fanfic/extras";
import { readFanficVersion } from "../../../../engine/modes/fanfic/versions";
import { fanficVoiceCharacters } from "../../../../engine/modes/fanfic/voices";
import {
  buildFanficAiIsmCleanupNotes,
  detectFanficAiIsms,
  fanficAiIsmNeedsCleanup,
} from "../../../../engine/modes/fanfic/ai-isms";
import { fanficChapterTitle, fanficPlannedChapterCount } from "../../../../engine/modes/fanfic/chapters";
import {
  buildFanficExport,
  fanficExportChapters,
  type FanficExportFormat,
} from "../../../../engine/modes/fanfic/export";
import { fanficBannedPhrases } from "../../../../engine/modes/fanfic/passage";
import { findFanficBannedPhrases } from "../../../../engine/modes/fanfic/phrase-bans";
import { fanficPlanNotes, readFanficPlan, type FanficPlanProposal } from "../../../../engine/modes/fanfic/plan";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import { joinContinuation } from "../../../../engine/shared/text/continuation";
import {
  detectFanficRepetition,
  fanficRepetitionNames,
  type FanficRepeat,
} from "../../../../engine/modes/fanfic/repetition";
import { FANFIC_RATING_LABELS, FANFIC_WARNING_LABELS } from "../../../../engine/modes/fanfic/request";
import { saveTextFileToUserSelectedLocation } from "../../../../shared/api/file-save-api";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { applyInlineMarkdown } from "../../../../shared/lib/markdown";
import { cn } from "../../../../shared/lib/utils";
import {
  useFanficContinuity,
  useFanficDeleteChapter,
  useFanficExtraCanon,
  useFanficKeepVersion,
  useFanficVoiceCheck,
  type FanficChapterView,
  type FanficContinuityController,
  type FanficEditorController,
  type FanficPhraseBanController,
  type FanficPlanController,
  type FanficLedgerController,
  type FanficVoiceCheckController,
  type FanficVoicesController,
  type FanficWriteArgs,
} from "../hooks/use-fanfic";
import { useFanficNarration, type FanficNarrationStatus } from "../hooks/use-fanfic-narration";
import type { FanficFinishedChapter } from "../lib/write-outcome";
import {
  buildFanficNarration,
  FANFIC_SCENE_BREAK,
  fanficProseBlocks,
  type FanficNarrationPlan,
} from "../lib/narration";
import { FanficResearchSources } from "./FanficOutlineView";
import { FanficContinuityProgress, FanficContinuityResult } from "./FanficContinuityResult";
import { FanficEditorPanel } from "./FanficEditorPanel";
import { FanficLedgerPanel } from "./FanficLedgerPanel";
import { FanficVoiceProgress, FanficVoiceResult } from "./FanficVoiceResult";
import { FanficVoicesPanel } from "./FanficVoicesPanel";
import { FanficBannedPhrasesPanel } from "./FanficBannedPhrasesPanel";
import { FanficChapterHeading } from "./FanficChapterHeading";
import { FanficReaderConnectionSelect } from "./FanficConnectionSelect";
import { FanficPassageEditor } from "./FanficPassageEditor";
import { FanficPlanPanel } from "./FanficPlanPanel";
import { FanficQualityPanel } from "./FanficQualityPanel";
import { FanficButton, FanficChip, FanficWaitNote, fanficInputClass } from "./fanfic-ui";
import { useChatStore } from "../../../../shared/stores/chat.store";

/** The chapter on screen by message id, or the entire work. */
type ReaderView = string;
const ENTIRE_WORK: ReaderView = "all";

interface FanficReaderProps {
  chatId: string;
  chatName: string;
  state: FanficState;
  chapters: FanficChapterView[];
  generating: boolean;
  streamText: string;
  phase: string | null;
  regeneratingMessageId: string | null;
  /** The chapter a running Continue adds to, with its text when the Continue started; the new text streams after it. */
  continuing: { messageId: string; textSoFar: string } | null;
  /** The main chapter a running write of a new extra follows; the extra streams at the end of that chapter's chain. */
  writingExtraAfter: number | null;
  onWrite: (args: FanficWriteArgs) => void;
  /** A chapter was finished outside a write (Keep as is); it gets the same follow-ups as a finished write. */
  onChapterFinished: (chapter: FanficFinishedChapter) => void;
  onRetry: () => void;
  onStop: () => void;
  ledger: FanficLedgerController;
  voices: FanficVoicesController;
  editor: FanficEditorController;
  plan: FanficPlanController;
  phraseBans: FanficPhraseBanController;
  /** null goes back to the default list. */
  onSaveBannedPhrases: (phrases: string[] | null) => Promise<void>;
  /** Uses a re-plan of the remaining chapters (the outline changes). */
  onUsePlan: (proposal: FanficPlanProposal) => Promise<void>;
  onSaveVoices: (voices: FanficVoiceSheet[]) => Promise<void>;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function chapterHeading(state: FanficState, number: number): string {
  const title = fanficChapterTitle(state, number);
  return `Chapter ${number}${title ? `: ${title}` : ""}`;
}

/** Extras aren't in the outline, so they carry their number only; an orphan says which chapter it lost. */
function refHeading(state: FanficState, ref: FanficChapterRef, orphan: boolean): string {
  if (orphan) return `Extra chapter (chapter ${ref.mainNumber} is gone)`;
  return ref.extra ? `Chapter ${ref.label}` : chapterHeading(state, ref.mainNumber);
}

/** An extra no later chapter builds on; orphans are never canon, so they count too. */
function isSideStory(ref: FanficChapterRef): boolean {
  return Boolean(ref.extra && !ref.extra.canon);
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
  chatId,
  busy,
  state,
  chatName,
  chapterCount,
  totalWords,
  onExport,
  showOutline,
  onToggleOutline,
  showQuality,
  onToggleQuality,
  showLedger,
  onToggleLedger,
  showVoices,
  onToggleVoices,
  showEditor,
  onToggleEditor,
}: {
  chatId: string;
  busy: boolean;
  state: FanficState;
  chatName: string;
  chapterCount: number;
  totalWords: number;
  onExport: (format: FanficExportFormat) => void;
  showOutline: boolean;
  onToggleOutline: () => void;
  showQuality: boolean;
  onToggleQuality: () => void;
  showLedger: boolean;
  onToggleLedger: () => void;
  showVoices: boolean;
  onToggleVoices: () => void;
  showEditor: boolean;
  onToggleEditor: () => void;
}) {
  const { request, outline } = state;
  const planned = fanficPlannedChapterCount(state);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
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
      <div className="mt-3 max-w-xs">
        <FanficReaderConnectionSelect chatId={chatId} busy={busy} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <FanficButton onClick={onToggleOutline} aria-expanded={showOutline}>
          <ListOrdered size="0.9rem" aria-hidden="true" />
          {showOutline ? "Hide outline" : "Outline"}
        </FanficButton>
        {state.research && (
          <FanficButton onClick={() => setResearchOpen((open) => !open)} aria-expanded={researchOpen}>
            <Search size="0.9rem" aria-hidden="true" />
            {researchOpen ? "Hide research" : "Research"}
          </FanficButton>
        )}
        <FanficButton onClick={onToggleQuality} aria-expanded={showQuality} disabled={chapterCount === 0}>
          <Gauge size="0.9rem" aria-hidden="true" />
          {showQuality ? "Hide quality" : "Quality"}
        </FanficButton>
        <FanficButton onClick={onToggleLedger} aria-expanded={showLedger} disabled={chapterCount === 0}>
          <BookMarked size="0.9rem" aria-hidden="true" />
          {showLedger ? "Hide ledger" : "Ledger"}
        </FanficButton>
        <FanficButton onClick={onToggleVoices} aria-expanded={showVoices}>
          <MessageSquareQuote size="0.9rem" aria-hidden="true" />
          {showVoices ? "Hide voices" : "Voices"}
        </FanficButton>
        <FanficButton onClick={onToggleEditor} aria-expanded={showEditor} disabled={chapterCount === 0}>
          <PenTool size="0.9rem" aria-hidden="true" />
          {showEditor ? "Hide editor" : "Editor"}
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
      {researchOpen && state.research && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-[var(--foreground)]/90">
            {state.research.notes}
          </p>
          <FanficResearchSources research={state.research} />
        </div>
      )}
    </header>
  );
}

function ChapterNav({
  options,
  view,
  onChange,
}: {
  /** Every chapter in reading order, by message id. */
  options: Array<{ messageId: string; label: string }>;
  view: ReaderView;
  onChange: (view: ReaderView) => void;
}) {
  if (options.length <= 1) return null;
  const current = options.findIndex((option) => option.messageId === view);
  return (
    <nav aria-label="Chapters" className="flex items-center gap-2">
      <FanficButton
        aria-label="Previous chapter"
        disabled={current <= 0}
        onClick={() => onChange(options[current - 1]!.messageId)}
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
        value={view}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ENTIRE_WORK}>Entire work</option>
        {options.map((option) => (
          <option key={option.messageId} value={option.messageId}>
            {option.label}
          </option>
        ))}
      </select>
      <FanficButton
        aria-label="Next chapter"
        disabled={current < 0 || current >= options.length - 1}
        onClick={() => onChange(options[current + 1]!.messageId)}
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

/** The delete confirmation names every chapter that goes: the last main chapter takes its extras with it. */
function deleteQuestion(labels: string[], orphan: boolean): string {
  const [label, ...extras] = labels;
  const what = orphan
    ? "this extra chapter? Its main chapter is gone."
    : extras.length > 0
      ? `chapter ${label} and its extra chapter${extras.length === 1 ? "" : "s"} ${joinWithAnd(extras)}?`
      : `chapter ${label}?`;
  return `Delete ${what} This can't be undone.`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function repeatLabel(repeat: FanficRepeat): string {
  if (repeat.kind === "pet_name") return `Calling someone “${repeat.term}”`;
  if (repeat.kind === "detail") return `“${repeat.term}” as a detail`;
  return `The phrase “${repeat.term}”`;
}

/**
 * Flags a chapter that leans on machine-sounding habits or keeps reusing the same pet name, detail, or phrase, and
 * offers a targeted clean-up rewrite.
 */
/** On a local model: the chapter's banned phrases, and a way to take them out. */
function BannedPhraseNotice({
  text,
  phrases,
  busy,
  running,
  onRemove,
}: {
  text: string;
  phrases: string[];
  busy: boolean;
  running: boolean;
  onRemove: () => void;
}) {
  const hits = useMemo(() => findFanficBannedPhrases(text, phrases), [phrases, text]);
  if (hits.length === 0 && !running) return null;
  const shown = [...new Set(hits.map((hit) => hit.match.toLowerCase()))].slice(0, 4);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3 text-xs"
    >
      <p className="min-w-0 flex-1 text-[var(--muted-foreground)]">
        {running ? (
          <>
            <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
            Taking banned phrases out…
          </>
        ) : (
          <>
            <span className="font-semibold text-[var(--foreground)]">
              {hits.length} banned {hits.length === 1 ? "phrase" : "phrases"}:
            </span>{" "}
            {shown.map((phrase) => `“${phrase}”`).join(", ")}
          </>
        )}
      </p>
      {!running && (
        <FanficButton disabled={busy} onClick={onRemove}>
          <Ban size="0.85rem" aria-hidden="true" />
          Remove them
        </FanficButton>
      )}
    </div>
  );
}

const UNFINISHED_REASON_TEXT: Record<FanficUnfinishedReason, string> = {
  provider_reset: "The provider started its reply over, so this chapter stopped where it was.",
  content_filter: "The provider's content filter stopped this chapter.",
  failure: "The write failed before this chapter was finished.",
  length: "This chapter hit the length limit before it was finished.",
};

/** A chapter whose shown version stopped early: why, and the ways to resolve it (or a model change first). */
function UnfinishedChapterNotice({
  chatId,
  unfinished,
  busy,
  keeping,
  onReset,
  onContinue,
  onKeep,
}: {
  chatId: string;
  unfinished: FanficUnfinished;
  busy: boolean;
  keeping: boolean;
  onReset: () => void;
  onContinue: () => void;
  onKeep: () => void;
}) {
  return (
    <section
      aria-label="Unfinished chapter"
      className="flex flex-col gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3"
    >
      <p className="text-[0.8125rem] font-semibold text-[var(--foreground)]">This chapter is unfinished</p>
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        {UNFINISHED_REASON_TEXT[unfinished.reason]} Reset writes it again, Continue picks up where it stops, and Keep as
        is leaves it as it reads now.
      </p>
      {unfinished.message && (
        <p className="text-xs italic leading-relaxed text-[var(--muted-foreground)]">{unfinished.message}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FanficButton disabled={busy} onClick={onReset}>
          <RotateCcw size="0.9rem" aria-hidden="true" />
          Reset
        </FanficButton>
        <FanficButton tone="primary" disabled={busy} onClick={onContinue}>
          <StepForward size="0.9rem" aria-hidden="true" />
          Continue
        </FanficButton>
        <FanficButton disabled={busy || keeping} onClick={onKeep}>
          <Check size="0.9rem" aria-hidden="true" />
          Keep as is
        </FanficButton>
        <div className="min-w-40 max-w-xs flex-1">
          <FanficReaderConnectionSelect chatId={chatId} busy={busy} />
        </div>
      </div>
    </section>
  );
}

function ProseCheckNotice({
  chapterTexts,
  chapterIndex,
  names,
  busy,
  onCleanUp,
}: {
  chapterTexts: string[];
  chapterIndex: number;
  names: string[];
  busy: boolean;
  onCleanUp: (notes: string) => void;
}) {
  const text = chapterTexts[chapterIndex] ?? "";
  const report = useMemo(() => detectFanficAiIsms(text), [text]);
  const repetition = useMemo(
    () => detectFanficRepetition(chapterTexts, { names, focus: chapterIndex }),
    [chapterIndex, chapterTexts, names],
  );
  const [open, setOpen] = useState(false);
  const aiIsms = fanficAiIsmNeedsCleanup(report);
  const repeats = repetition.repeats;
  if (!aiIsms && repeats.length === 0) return null;
  const total = report.findings.reduce((sum, finding) => sum + finding.count, 0);
  const top = report.findings.slice(0, 3).map((finding) => lowerFirst(finding.label));
  const repeatSummary = joinWithAnd(repeats.slice(0, 3).map((repeat) => `“${repeat.term}” (${repeat.count}×)`));
  return (
    <section
      aria-label="Prose check"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
    >
      <p className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
        {aiIsms ? "Sounds a bit AI-written" : "Repeats itself"}
      </p>
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        {aiIsms && `${total} habits spotted, mostly ${joinWithAnd(top)}. `}
        {repeats.length > 0 && `Keeps reusing ${repeatSummary}. `}A clean-up keeps the story and{" "}
        {aiIsms ? "rewrites how the sentences are built" : "cuts the repeats"}. It's saved as a new version, so you can
        flip back.
      </p>
      {open && (
        <ul className="flex flex-col gap-1.5 text-xs text-[var(--muted-foreground)]">
          {aiIsms &&
            report.findings.map((finding) => (
              <li key={finding.id}>
                <span className="font-semibold text-[var(--foreground)]">
                  {finding.label} ({finding.count})
                </span>
                {finding.examples.length > 0 && <span>: “{finding.examples[0]}”</span>}
              </li>
            ))}
          {repeats.map((repeat) => (
            <li key={`${repeat.kind}-${repeat.term}`}>
              <span className="font-semibold text-[var(--foreground)]">
                {repeatLabel(repeat)} ({repeat.count})
              </span>
              {repeat.examples.length > 0 && <span>: {repeat.examples[0]}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <FanficButton
          tone="primary"
          disabled={busy}
          onClick={() =>
            onCleanUp(buildFanficAiIsmCleanupNotes(aiIsms ? report : { ...report, findings: [] }, repetition))
          }
        >
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
  state,
  chapter,
  chapterRef,
  orphan,
  labels,
  nextExtraLabel,
  chapterTexts,
  chapterIndex,
  names,
  deleteLabels,
  onDelete,
  deleting,
  busy,
  blocked,
  onWrite,
  onKeep,
  keeping,
  onSetCanon,
  canonPending,
  continuity,
  voiceCheck,
  hasVoices,
  selection,
  onClearSelection,
  bannedPhrases,
  phraseBans,
}: {
  chatId: string;
  state: FanficState;
  chapter: FanficChapterView;
  /** The chapter's place in the layout: its label, and whether it is an extra. */
  chapterRef: FanficChapterRef;
  /** Its main chapter is gone: every write would need that chapter, so only reading and version switching stay. */
  orphan: boolean;
  /** Each chapter's current label by message id, for continuity results. */
  labels: ReadonlyMap<string, string>;
  /** For a main chapter, the label its next extra gets; null for an extra. */
  nextExtraLabel: string | null;
  /** The chapters this one is checked for repeats against: the canon line, plus its own chain for an extra. */
  chapterTexts: string[];
  /** This chapter's index in `chapterTexts`. */
  chapterIndex: number;
  names: string[];
  /** The labels of the chapters a delete takes (this one first); null when this chapter can't be deleted. */
  deleteLabels: string[] | null;
  onDelete: () => void;
  deleting: boolean;
  busy: boolean;
  /** Why chapter writes wait (a chapter is unfinished); null when they can run. */
  blocked: string | null;
  onWrite: (args: FanficWriteArgs) => void;
  onKeep: () => void;
  keeping: boolean;
  /** Marks this extra canon or a side story; null for a main chapter. */
  onSetCanon: ((canon: boolean) => void) | null;
  canonPending: boolean;
  continuity: FanficContinuityController;
  voiceCheck: FanficVoiceCheckController;
  hasVoices: boolean;
  /** Text the requester selected in this chapter, if any. */
  selection: string | null;
  onClearSelection: () => void;
  bannedPhrases: string[];
  phraseBans: FanficPhraseBanController;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "reset" | "extra" | "edit" | "passage">("idle");
  const [passage, setPassage] = useState("");
  const [notes, setNotes] = useState("");
  const [editText, setEditText] = useState("");
  const setActiveSwipe = useSetActiveSwipe(chatId);
  const updateMessage = useUpdateMessage(chatId);
  const { message } = chapter;
  const versions = Math.max(1, message.swipeCount ?? 1);
  const version = Math.min(versions, (message.activeSwipeIndex ?? 0) + 1);
  const continuityCheck = continuity.results[message.id];
  const voiceResult = voiceCheck.results[message.id];
  const shown = readFanficVersion(message.extra);
  const unfinished = shown?.unfinished ?? null;
  // Writes that save a version wait while a chapter is unfinished; reading, checks and version switching don't.
  const writeBusy = busy || Boolean(blocked);
  const replacesVersion = version - 1;
  const { label } = chapterRef;
  // A Reset reopens the box of the write that made the version: the next-chapter or extra box, or the revise box.
  // A version whose origin can't be read opens the revise box empty, like a redo.
  const resetsNewChapter = shown?.origin?.kind === "chapter" || shown?.origin?.kind === "extra";
  const startReset = () => {
    setNotes(shown?.origin?.notes ?? "");
    setMode("reset");
  };

  const deleteChapter = async () => {
    if (!deleteLabels) return;
    const confirmed = await showConfirmDialog({
      title: "Delete chapter",
      message: deleteQuestion(deleteLabels, orphan),
      confirmLabel: "Delete chapter",
      tone: "destructive",
    });
    if (confirmed) onDelete();
  };
  // Not a write, so an unfinished chapter doesn't hold it up.
  const deleteButton = deleteLabels && (
    <FanficButton tone="danger" disabled={busy || deleting} onClick={() => void deleteChapter()}>
      <Trash2 size="0.9rem" aria-hidden="true" />
      Delete
    </FanficButton>
  );

  const versionSwitch = versions > 1 && (
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
  );

  if (orphan) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {versionSwitch}
        {deleteButton}
      </div>
    );
  }

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
      {unfinished && mode !== "reset" && (
        <UnfinishedChapterNotice
          chatId={chatId}
          unfinished={unfinished}
          busy={busy}
          keeping={keeping}
          onReset={startReset}
          onContinue={() => onWrite({ kind: "continue", messageId: message.id })}
          onKeep={onKeep}
        />
      )}
      {mode === "reset" && resetsNewChapter && (
        <NextChapterPanel
          state={state}
          nextNumber={chapter.number}
          extraLabel={chapterRef.extra ? label : undefined}
          again
          busy={busy}
          onWrite={(args) => {
            const kind = shown?.origin?.kind === "extra" ? "extra" : "chapter";
            onWrite({ kind, messageId: message.id, replacesVersion, notes: args.notes });
            setMode("idle");
          }}
          notes={notes}
          setNotes={setNotes}
          onCancel={() => setMode("idle")}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {versionSwitch}
        <FanficButton
          disabled={writeBusy}
          title={blocked ?? undefined}
          onClick={() => setMode(mode === "revise" ? "idle" : "revise")}
        >
          <Wand2 size="0.9rem" aria-hidden="true" />
          Rewrite with notes
        </FanficButton>
        <FanficButton
          disabled={writeBusy}
          title={blocked ?? undefined}
          onClick={() => onWrite({ kind: "regenerate", messageId: message.id })}
        >
          <RefreshCw size="0.9rem" aria-hidden="true" />
          Redo
        </FanficButton>
        {nextExtraLabel && (
          <FanficButton
            disabled={writeBusy}
            title={blocked ?? undefined}
            onClick={() => {
              setNotes("");
              setMode(mode === "extra" ? "idle" : "extra");
            }}
          >
            <BookOpen size="0.9rem" aria-hidden="true" />
            Write extra chapter
          </FanficButton>
        )}
        {onSetCanon && chapterRef.extra && (
          // Not a write: it only changes what later writes read, so an unfinished chapter doesn't hold it up.
          <label
            className="flex min-h-8 items-center gap-2 text-xs font-semibold text-[var(--foreground)]"
            title="Canon extras are part of the story: later chapters build on them."
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--primary)]"
              checked={chapterRef.extra.canon}
              disabled={busy || canonPending}
              onChange={(event) => onSetCanon(event.target.checked)}
            />
            Canon
          </label>
        )}
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
        {(chapterRef.extra || chapter.number > 1) && (
          <FanficButton
            disabled={busy || continuity.running !== null || continuity.fixing}
            onClick={() => continuity.check(message.id)}
            title="Check this chapter against the ones before it"
          >
            <ShieldCheck size="0.9rem" aria-hidden="true" />
            Check continuity
          </FanficButton>
        )}
        {hasVoices && (
          <FanficButton
            disabled={busy || voiceCheck.running !== null || voiceCheck.fixing}
            onClick={() => voiceCheck.check(message.id)}
            title="Check every line against the voice sheets"
          >
            <MessageSquareQuote size="0.9rem" aria-hidden="true" />
            Check voice
          </FanficButton>
        )}
        {deleteButton}
      </div>
      {blocked && !unfinished && <p className="text-xs text-[var(--muted-foreground)]">{blocked}</p>}
      {mode === "extra" && nextExtraLabel && (
        <NextChapterPanel
          state={state}
          nextNumber={chapter.number}
          extraLabel={nextExtraLabel}
          busy={busy}
          blocked={blocked}
          onWrite={(args) => {
            onWrite({ kind: "extra", parentChapter: chapter.number, notes: args.notes });
            setMode("idle");
          }}
          notes={notes}
          setNotes={setNotes}
          onCancel={() => setMode("idle")}
        />
      )}
      {mode === "idle" && selection && (
        <div
          role="group"
          aria-label="Selected passage"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/8 p-2.5 text-xs"
        >
          <p className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">Selected:</span> “{selection}”
          </p>
          <FanficButton
            tone="primary"
            disabled={writeBusy}
            title={blocked ?? undefined}
            onClick={() => {
              setPassage(selection);
              setMode("passage");
              onClearSelection();
            }}
          >
            <TextSelect size="0.85rem" aria-hidden="true" />
            Rewrite this passage
          </FanficButton>
          <button
            type="button"
            onClick={onClearSelection}
            aria-label="Clear the selection"
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <X size="0.85rem" aria-hidden="true" />
          </button>
        </div>
      )}
      {mode === "passage" && (
        <FanficPassageEditor
          chatId={chatId}
          messageId={message.id}
          chapterLabel={label}
          textKey={fanficChapterTextKey(stripFanficChapterHeading(message.content))}
          selected={passage}
          busy={writeBusy}
          onClose={() => setMode("idle")}
        />
      )}
      {continuity.running === message.id && (
        <FanficContinuityProgress phase={continuity.phase} onStop={continuity.stop} />
      )}
      {mode === "idle" && continuityCheck && (
        <FanficContinuityResult
          check={continuityCheck}
          labels={labels}
          chapterText={stripFanficChapterHeading(message.content)}
          busy={writeBusy || continuity.fixing}
          onFix={(issues) =>
            void continuity.applyFixes(
              continuityCheck,
              issues.flatMap((issue) => (issue.fix ? [issue.fix] : [])),
            )
          }
          onRewrite={(rewriteNotes) => onWrite({ kind: "revise", messageId: message.id, notes: rewriteNotes })}
          onDismiss={() => continuity.dismiss(message.id)}
          helperNote={
            <HelperRunNote
              task="fanficChecks"
              job="continuity check"
              chatId={chatId}
              className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]"
            />
          }
        />
      )}
      {voiceCheck.running === message.id && <FanficVoiceProgress phase={voiceCheck.phase} onStop={voiceCheck.stop} />}
      {mode === "idle" && voiceResult && (
        <FanficVoiceResult
          check={voiceResult}
          chapterText={stripFanficChapterHeading(message.content)}
          busy={writeBusy || voiceCheck.fixing}
          onFix={(issues) =>
            void voiceCheck.applyFixes(
              voiceResult,
              issues.flatMap((issue) => (issue.fix ? [issue.fix] : [])),
            )
          }
          onRewrite={(rewriteNotes) => onWrite({ kind: "revise", messageId: message.id, notes: rewriteNotes })}
          onDismiss={() => voiceCheck.dismiss(message.id)}
          helperNote={
            <HelperRunNote
              task="fanficChecks"
              job="voice check"
              chatId={chatId}
              className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]"
            />
          }
        />
      )}
      {mode === "idle" && phraseBans.supported && (
        <BannedPhraseNotice
          text={stripFanficChapterHeading(message.content)}
          phrases={bannedPhrases}
          busy={writeBusy || phraseBans.running !== null}
          running={phraseBans.running === message.id}
          onRemove={() => phraseBans.remove({ messageId: message.id })}
        />
      )}
      {mode === "idle" && (
        <ProseCheckNotice
          chapterTexts={chapterTexts}
          chapterIndex={chapterIndex}
          names={names}
          busy={writeBusy}
          onCleanUp={(cleanupNotes) => onWrite({ kind: "revise", messageId: message.id, notes: cleanupNotes })}
        />
      )}
      {(mode === "revise" || (mode === "reset" && !resetsNewChapter)) && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "reset") {
              // Notes make it a rewrite of the version a revision started from; without them it is a plain redo.
              const kind = notes.trim() && shown?.origin?.kind === "revise" ? "revise" : "regenerate";
              onWrite({ kind, messageId: message.id, replacesVersion, notes: notes.trim() ? notes : "" });
            } else {
              if (!notes.trim()) return;
              onWrite({ kind: "revise", messageId: message.id, notes });
            }
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
            {mode === "reset"
              ? "The chapter is written again in place of the unfinished version. With no notes it's a plain redo."
              : "The rewrite is added as a new version, so you can flip back. Later chapters stay as they are."}
          </p>
          <div className="flex justify-end gap-2">
            <FanficButton onClick={() => setMode("idle")}>Cancel</FanficButton>
            {mode === "reset" ? (
              <FanficButton type="submit" tone="primary" disabled={busy}>
                Write chapter {label} again
              </FanficButton>
            ) : (
              <FanficButton type="submit" tone="primary" disabled={!notes.trim()}>
                Rewrite chapter {label}
              </FanficButton>
            )}
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
              ? `About ${plan.characters.toLocaleString()} ElevenLabs characters${
                  plan.soundEffects > 0
                    ? ` and ${plan.soundEffects} sound effect${plan.soundEffects === 1 ? "" : "s"}`
                    : ""
                } the first time. Replays are free.`
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
  chatId,
  heading,
  text,
  phase,
  onStop,
  waiting = false,
}: {
  chatId: string;
  heading: string;
  text: string;
  phase: string | null;
  onStop: () => void;
  /** The text shown is the chapter so far and the new words haven't started yet. */
  waiting?: boolean;
}) {
  const startedAt = useChatStore((s) => s.generationPhaseStartedAtByChatId.get(chatId) ?? null);
  const status = (
    <div className="flex flex-col gap-1">
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 size="1rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
        {phase || "Writing…"}
      </p>
      <FanficWaitNote startedAt={startedAt} stopLabel="Stop" />
    </div>
  );
  return (
    <article aria-busy="true" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-[var(--foreground)]">{heading}</h3>
        <FanficButton onClick={onStop}>
          <Square size="0.8rem" aria-hidden="true" />
          Stop
        </FanficButton>
      </div>
      {text.trim() ? <Prose text={text} keyBase="fanfic-stream" /> : status}
      {text.trim() && waiting && status}
    </article>
  );
}

function NextChapterPanel({
  state,
  nextNumber,
  extraLabel,
  again = false,
  busy,
  blocked = null,
  onWrite,
  notes,
  setNotes,
  onPlanAhead,
  planning = false,
  onCancel,
  continuesFrom,
}: {
  state: FanficState;
  nextNumber: number;
  /** Set for an extra chapter, by its N.x label: the outline doesn't plan it, so it has no title and no "complete". */
  extraLabel?: string;
  /** The box writes an unfinished chapter again (Reset) instead of a new one. */
  again?: boolean;
  busy: boolean;
  /** Why the chapter can't be written yet; the write button waits. */
  blocked?: string | null;
  onWrite: (args: FanficWriteArgs) => void;
  notes: string;
  setNotes: (notes: string) => void;
  /** Re-plans the rest (or suggests the next chapter) from what's written. */
  onPlanAhead?: () => void;
  planning?: boolean;
  /** Set when the box can be closed without writing (a Reset or an extra). */
  onCancel?: () => void;
  /** The next main chapter after one with extras: which chapter's end it picks up from (`current`) and the choices. */
  continuesFrom?: { labels: string[]; current: string; switching: boolean; onSwitch: (label: string) => void };
}) {
  const planned = fanficPlannedChapterCount(state);
  const complete = !extraLabel && nextNumber > planned;
  const label = extraLabel ?? String(nextNumber);
  const title = extraLabel ? "" : fanficChapterTitle(state, nextNumber);
  const newExtra = Boolean(extraLabel) && !again;
  const notesId = again ? "fanfic-reset-notes" : extraLabel ? `fanfic-extra-notes-${extraLabel}` : "fanfic-next-notes";
  return (
    <section
      aria-label={newExtra ? `Extra chapter ${extraLabel}` : undefined}
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4"
    >
      {again ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Write chapter {label}
          {title ? `: ${title}` : ""} again
        </p>
      ) : newExtra ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">Extra chapter {label}</p>
      ) : complete ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          <span aria-hidden="true">✦ </span>Complete. All {planned} planned chapters are written.
        </p>
      ) : (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Up next: Chapter {nextNumber}
          {title ? `: ${title}` : ""}
        </p>
      )}
      {continuesFrom && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="fanfic-continues-from" className="text-xs text-[var(--muted-foreground)]">
            Continues from
          </label>
          <select
            id="fanfic-continues-from"
            className={cn(fanficInputClass, "w-auto")}
            value={continuesFrom.current}
            disabled={busy || continuesFrom.switching}
            onChange={(event) => continuesFrom.onSwitch(event.target.value)}
          >
            {continuesFrom.labels.map((from) => (
              <option key={from} value={from}>{`End of chapter ${from}`}</option>
            ))}
          </select>
        </div>
      )}
      <label htmlFor={notesId} className="mt-2 block text-xs text-[var(--muted-foreground)]">
        Notes for this chapter (optional)
      </label>
      <textarea
        id={notesId}
        className={cn(fanficInputClass, "mt-1 min-h-14 resize-y")}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder={
          extraLabel
            ? "A flashback from Crowley's point of view."
            : complete
              ? "An epilogue five years later…"
              : "Give Aziraphale a bigger moment here."
        }
      />
      {newExtra && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Left empty, the model picks something that fits the story. It starts as a side story; mark it canon to have
          later chapters build on it.
        </p>
      )}
      {blocked && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{blocked}</p>}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {onCancel && <FanficButton onClick={onCancel}>Cancel</FanficButton>}
        {onPlanAhead && (
          <FanficButton disabled={busy || planning} onClick={onPlanAhead}>
            <Compass size="0.9rem" aria-hidden="true" />
            {complete ? "Suggest what's next" : "Re-plan the rest"}
          </FanficButton>
        )}
        <FanficButton
          tone="primary"
          disabled={busy || Boolean(blocked)}
          title={blocked ?? undefined}
          className="min-h-11 px-5"
          onClick={() => {
            onWrite({ kind: "chapter", notes });
            setNotes("");
          }}
        >
          <BookOpen size="1rem" aria-hidden="true" />
          {complete ? "Write a bonus chapter" : `Write chapter ${label}`}
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
  continuing,
  writingExtraAfter,
  onWrite,
  onChapterFinished,
  onRetry,
  onStop,
  ledger,
  voices,
  onSaveVoices,
  editor,
  plan,
  onUsePlan,
  phraseBans,
  onSaveBannedPhrases,
}: FanficReaderProps) {
  const rows = useMemo(
    () =>
      chapters.map(({ message }) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        extra: message.extra,
      })),
    [chapters],
  );
  const layout = useMemo(() => fanficChapterLayout(rows), [rows]);
  const refs = useMemo(() => new Map(layout.chapters.map((ref) => [ref.messageId, ref])), [layout]);
  const labels = useMemo(() => new Map(layout.chapters.map((ref) => [ref.messageId, ref.label])), [layout]);
  const isOrphan = (ref: FanficChapterRef) => layout.orphans.includes(ref);
  const canonLine = useMemo(() => fanficCanonLine(layout), [layout]);
  // The editor scores every chapter a write can build on; an orphan's context is gone.
  const editable = useMemo(() => layout.chapters.filter((ref) => !layout.orphans.includes(ref)), [layout]);
  const navOptions = layout.chapters.map((ref) => ({
    messageId: ref.messageId,
    label: `${refHeading(state, ref, isOrphan(ref))}${isSideStory(ref) ? " (side story)" : ""}`,
  }));
  const chapterCount = layout.mains.length;
  const lastMain = layout.mains.at(-1);
  // A fic opens on its last main chapter.
  const [view, setView] = useState<ReaderView>(lastMain?.messageId ?? ENTIRE_WORK);
  const current = view === ENTIRE_WORK ? undefined : refs.get(view);
  // The chapters before the one in view, nearest first, so a deleted chapter falls back to the one before it.
  const [behindView, setBehindView] = useState<string[]>([]);
  useEffect(() => {
    if (current)
      setBehindView(
        layout.chapters
          .slice(0, current.position)
          .map((ref) => ref.messageId)
          .reverse(),
      );
  }, [current, layout]);
  const fallback = behindView.map((id) => refs.get(id)).find((ref) => ref !== undefined);
  const viewed = view === ENTIRE_WORK ? null : (current ?? fallback ?? lastMain ?? null);
  const texts = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.message.id, chapter.message.content])),
    [chapters],
  );
  /**
   * What each chapter is checked for repeats against, as overusedElsewhere picks it: the canon line and its own chain.
   * Kept per chapter, so the checks don't run again on every render.
   */
  const repetitionPools = useMemo(
    () =>
      new Map(
        layout.chapters.map((ref) => {
          const pool = editable.filter(
            (other) => !other.extra || other.extra.canon || (ref.extra !== null && other.mainNumber === ref.mainNumber),
          );
          return [
            ref.messageId,
            { texts: pool.map((other) => texts.get(other.messageId) ?? ""), index: pool.indexOf(ref) },
          ];
        }),
      ),
    [editable, layout, texts],
  );
  const repetitionNames = useMemo(() => fanficRepetitionNames(state.request), [state.request]);
  const [showOutline, setShowOutline] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [nextNotes, setNextNotes] = useState("");
  const bannedPhrases = useMemo(() => fanficBannedPhrases(state), [state]);
  const [selection, setSelection] = useState<{ messageId: string; text: string } | null>(null);
  // A selection inside a chapter's prose offers a passage rewrite. It stays offered after the selection collapses
  // (tapping the button on a phone clears it) until it's used, dismissed, or replaced.
  useEffect(() => {
    const onChange = () => {
      const current = window.getSelection();
      if (!current || current.isCollapsed) return;
      const text = current.toString().replace(/\s+/g, " ").trim();
      if (text.split(" ").length < 3) return;
      const hostOf = (node: Node | null) =>
        (node instanceof Element ? node : node?.parentElement)?.closest("[data-fanfic-prose]") ?? null;
      const host = hostOf(current.anchorNode);
      if (!host || host !== hostOf(current.focusNode)) return;
      setSelection({ messageId: host.getAttribute("data-fanfic-prose") ?? "", text });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  const { data: chat } = useChat(chatId);
  const proposal = useMemo(() => readFanficPlan(chat?.metadata, layout), [chat?.metadata, layout]);
  const continuity = useFanficContinuity(chatId);
  const voiceCheck = useFanficVoiceCheck(chatId);
  const keepVersion = useFanficKeepVersion(chatId);
  const extraCanon = useFanficExtraCanon(chatId);
  const deleteChapter = useFanficDeleteChapter(chatId);
  // The next main chapter picks up after the last main chapter's last canon extra, or after that chapter itself.
  const lastChain = (lastMain && layout.chains.get(lastMain.mainNumber)) || [];
  const lastCanon = lastChain.filter((ref) => ref.extra?.canon).at(-1);
  const continuesFrom =
    lastMain && lastChain.length > 0
      ? {
          labels: [...new Set([lastMain.label, lastCanon?.label ?? lastMain.label, lastChain.at(-1)!.label])],
          current: lastCanon?.label ?? lastMain.label,
          switching: extraCanon.isPending,
          onSwitch: (label: string) =>
            extraCanon.mutate({ parentChapter: lastMain.mainNumber, canon: label !== lastMain.label }),
        }
      : undefined;
  // The engine refuses other writes while a chapter is unfinished; the reader disables them with the same reason.
  const blocked = useMemo(() => {
    const unfinished = fanficUnfinishedChapter(rows);
    return unfinished ? fanficUnfinishedReason(unfinished) : null;
  }, [rows]);
  const topRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(chapterCount);
  const writingExtra = generating && writingExtraAfter !== null;
  const writingNew = generating && !regeneratingMessageId && !continuing && !writingExtra;
  // A new extra streams where it will appear: right after the last chapter of its main chapter's chain.
  const extraStreamAfter =
    generating && writingExtraAfter !== null
      ? ((layout.chains.get(writingExtraAfter)?.at(-1) ?? layout.mains[writingExtraAfter - 1])?.messageId ?? null)
      : null;
  const narration = useFanficNarration(chatId);
  const { stop: stopNarration } = narration;

  // Jump to a main chapter as soon as it is written.
  const lastMainId = lastMain?.messageId;
  useEffect(() => {
    if (chapterCount > previousCount.current && lastMainId) setView(lastMainId);
    previousCount.current = chapterCount;
  }, [chapterCount, lastMainId]);
  // A new extra opens on its own page once it is written, as a new main chapter does.
  const extraIds = useMemo(() => layout.chapters.filter((ref) => ref.extra).map((ref) => ref.messageId), [layout]);
  const previousExtras = useRef(new Set(extraIds));
  useEffect(() => {
    const added = extraIds.filter((id) => !previousExtras.current.has(id));
    if (added.length > 0) setView(added.at(-1)!);
    previousExtras.current = new Set(extraIds);
  }, [extraIds]);

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
    const file = buildFanficExport({ state, chapters: fanficExportChapters(rows), fallbackTitle: chatName }, format);
    try {
      const result = await saveTextFileToUserSelectedLocation({
        filename: file.filename,
        content: file.content,
        mimeType: `${file.mimeType};charset=utf-8`,
        filters: [{ name: format === "html" ? "HTML" : "Markdown", extensions: [format === "html" ? "html" : "md"] }],
      });
      if (result !== "cancelled") toast.success(`Saved ${file.filename}`);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't save the fic. Try again." }));
    }
  };

  // Every chapter, extras included, is read on its own page.
  const visible = useMemo(
    () => (viewed ? chapters.filter((chapter) => chapter.message.id === viewed.messageId) : chapters),
    [chapters, viewed],
  );
  const viewingLast = !viewed || viewed.position >= (lastMain?.position ?? 0);
  // A new extra streams in place of a page of its chain (its main chapter or one of its extras), and in the entire
  // work after the chain (null marks it). Any other chapter in view stays as it is.
  const shown = useMemo(() => {
    if (extraStreamAfter === null) return visible;
    if (viewed) {
      const anchor = viewed.mainNumber === writingExtraAfter && !layout.orphans.includes(viewed);
      return anchor ? [null] : visible;
    }
    return visible.flatMap((chapter) => (chapter.message.id === extraStreamAfter ? [chapter, null] : [chapter]));
  }, [extraStreamAfter, layout, viewed, visible, writingExtraAfter]);
  const narrationConfig = narration.config;
  const narrationPlan = useMemo(
    () =>
      narrationConfig
        ? buildFanficNarration(
            visible.map((chapter) => {
              const ref = refs.get(chapter.message.id)!;
              const heading = refHeading(state, ref, layout.orphans.includes(ref));
              return {
                messageId: chapter.message.id,
                label: ref.label,
                // Spoken, so the side-story mark is said rather than bracketed.
                heading: isSideStory(ref) ? `${heading}, a side story` : heading,
                content: chapter.message.content,
              };
            }),
            narrationConfig,
          )
        : null,
    [layout, narrationConfig, refs, state, visible],
  );
  const narratedPart = narration.currentPart;
  const narrationScope =
    !viewed && chapters.length > 1
      ? "the whole work"
      : viewed && isOrphan(viewed)
        ? "this extra chapter"
        : `chapter ${(viewed ?? lastMain)?.label ?? 1}`;

  return (
    <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 pb-10">
      <WorkHeader
        chatId={chatId}
        busy={generating}
        state={state}
        chatName={chatName}
        chapterCount={chapterCount}
        totalWords={totalWords}
        onExport={(format) => void exportFic(format)}
        showOutline={showOutline}
        onToggleOutline={() => setShowOutline((open) => !open)}
        showQuality={showQuality}
        onToggleQuality={() => setShowQuality((open) => !open)}
        showLedger={showLedger}
        onToggleLedger={() => setShowLedger((open) => !open)}
        showVoices={showVoices}
        onToggleVoices={() => setShowVoices((open) => !open)}
        showEditor={showEditor}
        onToggleEditor={() => setShowEditor((open) => !open)}
      />
      {showLedger && chapterCount > 0 && (
        <FanficLedgerPanel chatId={chatId} chapters={canonLine} ledger={ledger} busy={generating} />
      )}
      {showEditor && chapterCount > 0 && (
        <FanficEditorPanel
          chatId={chatId}
          chapters={editable}
          controller={editor}
          busy={generating}
          blocked={blocked}
          onRewritten={(report) => {
            // Open the rewritten chapter and check it against the story, so a slip the rewrite made is caught.
            changeView(report.messageId);
            continuity.check(report.messageId);
          }}
        />
      )}
      {showEditor && (
        <FanficBannedPhrasesPanel
          phrases={fanficBannedPhrases(state)}
          customized={state.bannedPhrases !== undefined}
          supported={phraseBans.supported}
          onSave={onSaveBannedPhrases}
        />
      )}
      {showVoices && (
        <FanficVoicesPanel
          voices={state.voices ?? []}
          controller={voices}
          canBuild={fanficVoiceCharacters(state.request).length > 0}
          busy={generating}
          onSave={onSaveVoices}
          helperNote={
            <HelperRunNote
              task="fanficPlanning"
              job="voice sheets"
              chatId={chatId}
              className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]"
            />
          }
        />
      )}
      {/* Hidden rather than unmounted, so a check still running shows its progress (and blocks a second run) when reopened. */}
      {chapterCount > 0 && (
        <div hidden={!showQuality}>
          <FanficQualityPanel chatId={chatId} layout={layout} busy={generating} />
        </div>
      )}
      <div ref={topRef} className="scroll-mt-4">
        <ChapterNav options={navOptions} view={viewed?.messageId ?? ENTIRE_WORK} onChange={changeView} />
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

      {shown.map((chapter) => {
        if (!chapter) {
          return (
            <StreamingChapter
              key="fanfic-extra-stream"
              chatId={chatId}
              heading={`Chapter ${fanficExtraPlace(layout, writingExtraAfter ?? 0).label}`}
              text={streamText}
              phase={phase}
              onStop={onStop}
            />
          );
        }
        const ref = refs.get(chapter.message.id)!;
        const regenerating = generating && regeneratingMessageId === chapter.message.id;
        const continued = generating && continuing?.messageId === chapter.message.id ? continuing : null;
        const orphan = isOrphan(ref);
        const heading = refHeading(state, ref, orphan);
        const pool = repetitionPools.get(ref.messageId)!;
        if (regenerating || continued) {
          return (
            <StreamingChapter
              key={chapter.message.id}
              chatId={chatId}
              heading={heading}
              text={continued ? joinContinuation(continued.textSoFar, streamText) : streamText}
              waiting={Boolean(continued) && !streamText.trim()}
              phase={phase}
              onStop={onStop}
            />
          );
        }
        return (
          <article key={chapter.message.id} className="flex flex-col gap-3" aria-labelledby={`fanfic-ch-${ref.label}`}>
            <FanficChapterHeading
              id={`fanfic-ch-${ref.label}`}
              heading={heading}
              extra={chapter.message.extra}
              sideStory={isSideStory(ref)}
            />
            <div data-fanfic-prose={chapter.message.id}>
              <Prose
                text={chapter.message.content}
                keyBase={`fanfic-${chapter.message.id}`}
                activeBlock={narratedPart?.chapterLabel === ref.label ? narratedPart.block : null}
              />
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <ChapterTools
                chatId={chatId}
                state={state}
                chapter={chapter}
                chapterRef={ref}
                orphan={orphan}
                labels={labels}
                nextExtraLabel={ref.extra ? null : fanficExtraPlace(layout, ref.mainNumber).label}
                chapterTexts={pool.texts}
                chapterIndex={pool.index}
                names={repetitionNames}
                // Any extra can go; a main chapter only while it is the last one, and its extras go with it.
                deleteLabels={ref.extra || ref === lastMain ? fanficDeletePlan(layout, ref.messageId).labels : null}
                onDelete={() => deleteChapter.mutate(chapter.message.id)}
                deleting={deleteChapter.isPending}
                busy={generating}
                blocked={blocked}
                onWrite={onWrite}
                onKeep={() =>
                  keepVersion.mutate(chapter.message.id, {
                    onSuccess: () =>
                      onChapterFinished({
                        messageId: chapter.message.id,
                        // An unreadable record proposes no plan: it can't be told to be a new chapter.
                        origin: readFanficVersion(chapter.message.extra)?.origin?.kind ?? null,
                      }),
                  })
                }
                keeping={keepVersion.isPending}
                onSetCanon={
                  ref.extra && !orphan ? (canon) => extraCanon.mutate({ messageId: chapter.message.id, canon }) : null
                }
                canonPending={extraCanon.isPending}
                continuity={continuity}
                voiceCheck={voiceCheck}
                hasVoices={(state.voices?.length ?? 0) > 0}
                selection={selection?.messageId === chapter.message.id ? selection.text : null}
                onClearSelection={() => setSelection(null)}
                bannedPhrases={bannedPhrases}
                phraseBans={phraseBans}
              />
            </div>
          </article>
        );
      })}

      {writingNew && (
        <StreamingChapter
          chatId={chatId}
          heading={chapterHeading(state, chapterCount + 1)}
          text={streamText}
          phase={phase}
          onStop={onStop}
        />
      )}

      <GenerationFailureNotice chatId={chatId} onRetry={onRetry} />

      {viewingLast && !generating && (proposal || plan.running) && (
        <FanficPlanPanel
          proposal={proposal}
          controller={plan}
          busy={generating}
          helperNote={
            <HelperRunNote
              task="fanficPlanning"
              job="living outline"
              chatId={chatId}
              className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]"
            />
          }
          onUse={async (used) => {
            if (used.mode === "next") {
              setNextNotes(fanficPlanNotes(used));
              await plan.dismiss();
              toast.success(
                `Chapter ${used.chapters[0]?.number}'s notes are filled in below. Change anything before writing.`,
              );
            } else await onUsePlan(used);
          }}
        />
      )}
      {viewingLast && !generating && (
        <NextChapterPanel
          state={state}
          nextNumber={chapterCount + 1}
          busy={generating}
          blocked={blocked}
          onWrite={onWrite}
          notes={nextNotes}
          setNotes={setNextNotes}
          onPlanAhead={() => plan.propose()}
          planning={plan.running}
          continuesFrom={continuesFrom}
        />
      )}
    </div>
  );
}
