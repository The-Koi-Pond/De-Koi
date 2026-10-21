import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toUserMessage } from "../../../../shared/lib/error-message";
import {
  Ban,
  BookMarked,
  BookOpen,
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
  ShieldCheck,
  Sparkles,
  Square,
  TextSelect,
  X,
  Trash2,
  Wand2,
} from "lucide-react";
import { useChat, useDeleteMessage, useSetActiveSwipe, useUpdateMessage } from "../../../catalog/chats/index";
import { GenerationFailureNotice } from "../../../runtime/generation/index";
import type { FanficState, FanficVoiceSheet } from "../../../../engine/contracts/types/fanfic";
import { fanficVoiceCharacters } from "../../../../engine/modes/fanfic/voices";
import {
  buildFanficAiIsmCleanupNotes,
  detectFanficAiIsms,
  fanficAiIsmNeedsCleanup,
} from "../../../../engine/modes/fanfic/ai-isms";
import { fanficChapterTitle, fanficPlannedChapterCount } from "../../../../engine/modes/fanfic/chapters";
import { buildFanficExport, type FanficExportFormat } from "../../../../engine/modes/fanfic/export";
import { fanficBannedPhrases } from "../../../../engine/modes/fanfic/passage";
import { findFanficBannedPhrases } from "../../../../engine/modes/fanfic/phrase-bans";
import { fanficPlanNotes, readFanficPlan, type FanficPlanProposal } from "../../../../engine/modes/fanfic/plan";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
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
  fanficChapterViewRefs,
  useFanficContinuity,
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
import { FanficPassageEditor } from "./FanficPassageEditor";
import { FanficPlanPanel } from "./FanficPlanPanel";
import { FanficQualityPanel } from "./FanficQualityPanel";
import { FanficButton, FanficChip, FanficWaitNote, fanficInputClass } from "./fanfic-ui";
import { useChatStore } from "../../../../shared/stores/chat.store";

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
  showQuality,
  onToggleQuality,
  showLedger,
  onToggleLedger,
  showVoices,
  onToggleVoices,
  showEditor,
  onToggleEditor,
}: {
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
  chapter,
  chapterTexts,
  names,
  isLast,
  busy,
  onWrite,
  continuity,
  voiceCheck,
  hasVoices,
  selection,
  onClearSelection,
  bannedPhrases,
  phraseBans,
}: {
  chatId: string;
  chapter: FanficChapterView;
  chapterTexts: string[];
  names: string[];
  isLast: boolean;
  busy: boolean;
  onWrite: (args: FanficWriteArgs) => void;
  continuity: FanficContinuityController;
  voiceCheck: FanficVoiceCheckController;
  hasVoices: boolean;
  /** Text the requester selected in this chapter, if any. */
  selection: string | null;
  onClearSelection: () => void;
  bannedPhrases: string[];
  phraseBans: FanficPhraseBanController;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "edit" | "passage">("idle");
  const [passage, setPassage] = useState("");
  const [notes, setNotes] = useState("");
  const [editText, setEditText] = useState("");
  const setActiveSwipe = useSetActiveSwipe(chatId);
  const updateMessage = useUpdateMessage(chatId);
  const deleteMessage = useDeleteMessage(chatId);
  const { message } = chapter;
  const versions = Math.max(1, message.swipeCount ?? 1);
  const version = Math.min(versions, (message.activeSwipeIndex ?? 0) + 1);
  const continuityCheck = continuity.results[message.id];
  const voiceResult = voiceCheck.results[message.id];

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
        {chapter.number > 1 && (
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
        {isLast && (
          <FanficButton tone="danger" disabled={busy || deleteMessage.isPending} onClick={() => void deleteChapter()}>
            <Trash2 size="0.9rem" aria-hidden="true" />
            Delete
          </FanficButton>
        )}
      </div>
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
            disabled={busy}
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
          chapterNumber={chapter.number}
          textKey={fanficChapterTextKey(stripFanficChapterHeading(message.content))}
          selected={passage}
          busy={busy}
          onClose={() => setMode("idle")}
        />
      )}
      {continuity.running === message.id && (
        <FanficContinuityProgress phase={continuity.phase} onStop={continuity.stop} />
      )}
      {mode === "idle" && continuityCheck && (
        <FanficContinuityResult
          check={continuityCheck}
          chapterText={stripFanficChapterHeading(message.content)}
          busy={busy || continuity.fixing}
          onFix={(issues) =>
            void continuity.applyFixes(
              continuityCheck,
              issues.flatMap((issue) => (issue.fix ? [issue.fix] : [])),
            )
          }
          onRewrite={(rewriteNotes) => onWrite({ kind: "revise", messageId: message.id, notes: rewriteNotes })}
          onDismiss={() => continuity.dismiss(message.id)}
        />
      )}
      {voiceCheck.running === message.id && <FanficVoiceProgress phase={voiceCheck.phase} onStop={voiceCheck.stop} />}
      {mode === "idle" && voiceResult && (
        <FanficVoiceResult
          check={voiceResult}
          chapterText={stripFanficChapterHeading(message.content)}
          busy={busy || voiceCheck.fixing}
          onFix={(issues) =>
            void voiceCheck.applyFixes(
              voiceResult,
              issues.flatMap((issue) => (issue.fix ? [issue.fix] : [])),
            )
          }
          onRewrite={(rewriteNotes) => onWrite({ kind: "revise", messageId: message.id, notes: rewriteNotes })}
          onDismiss={() => voiceCheck.dismiss(message.id)}
        />
      )}
      {mode === "idle" && phraseBans.supported && (
        <BannedPhraseNotice
          text={stripFanficChapterHeading(message.content)}
          phrases={bannedPhrases}
          busy={busy || phraseBans.running !== null}
          running={phraseBans.running === message.id}
          onRemove={() => phraseBans.remove({ messageId: message.id })}
        />
      )}
      {mode === "idle" && (
        <ProseCheckNotice
          chapterTexts={chapterTexts}
          chapterIndex={chapter.number - 1}
          names={names}
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
  chatId,
  heading,
  text,
  phase,
  onStop,
}: {
  chatId: string;
  heading: string;
  text: string;
  phase: string | null;
  onStop: () => void;
}) {
  const startedAt = useChatStore((s) => s.generationPhaseStartedAtByChatId.get(chatId) ?? null);
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
        <div className="flex flex-col gap-1">
          <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 size="1rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
            {phase || "Writing…"}
          </p>
          <FanficWaitNote startedAt={startedAt} stopLabel="Stop" />
        </div>
      )}
    </article>
  );
}

function NextChapterPanel({
  state,
  nextNumber,
  busy,
  onWrite,
  notes,
  setNotes,
  onPlanAhead,
  planning,
}: {
  state: FanficState;
  nextNumber: number;
  busy: boolean;
  onWrite: (args: FanficWriteArgs) => void;
  notes: string;
  setNotes: (notes: string) => void;
  /** Re-plans the rest (or suggests the next chapter) from what's written. */
  onPlanAhead: () => void;
  planning: boolean;
}) {
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
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <FanficButton disabled={busy || planning} onClick={onPlanAhead}>
          <Compass size="0.9rem" aria-hidden="true" />
          {complete ? "Suggest what's next" : "Re-plan the rest"}
        </FanficButton>
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
  ledger,
  voices,
  onSaveVoices,
  editor,
  plan,
  onUsePlan,
  phraseBans,
  onSaveBannedPhrases,
}: FanficReaderProps) {
  const chapterCount = chapters.length;
  const [view, setView] = useState<ReaderView>(Math.max(1, chapterCount));
  const chapterTexts = useMemo(() => chapters.map((chapter) => chapter.message.content), [chapters]);
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
  const chapterRefs = useMemo(() => fanficChapterViewRefs(chapters), [chapters]);
  const proposal = useMemo(() => readFanficPlan(chat?.metadata, chapterRefs), [chat?.metadata, chapterRefs]);
  const continuity = useFanficContinuity(chatId, null);
  const voiceCheck = useFanficVoiceCheck(chatId, null);
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
      toast.error(toUserMessage(error, { fallback: "Couldn't save the fic. Try again." }));
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
        <FanficLedgerPanel chatId={chatId} chapters={chapters} ledger={ledger} busy={generating} />
      )}
      {showEditor && chapterCount > 0 && (
        <FanficEditorPanel
          chatId={chatId}
          chapters={chapters}
          controller={editor}
          busy={generating}
          onRewritten={(report) => {
            // Open the rewritten chapter and check it against the story, so a slip the rewrite made is caught.
            changeView(report.chapter);
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
        />
      )}
      {/* Hidden rather than unmounted, so a check still running shows its progress (and blocks a second run) when reopened. */}
      {chapterCount > 0 && (
        <div hidden={!showQuality}>
          <FanficQualityPanel chatId={chatId} chapterTexts={chapterTexts} busy={generating} />
        </div>
      )}
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
              chatId={chatId}
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
            <div data-fanfic-prose={chapter.message.id}>
              <Prose
                text={chapter.message.content}
                keyBase={`fanfic-${chapter.message.id}`}
                activeBlock={narratedPart?.chapterNumber === chapter.number ? narratedPart.block : null}
              />
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <ChapterTools
                chatId={chatId}
                chapter={chapter}
                chapterTexts={chapterTexts}
                names={repetitionNames}
                isLast={chapter.number === chapterCount}
                busy={generating}
                onWrite={onWrite}
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
          onWrite={onWrite}
          notes={nextNotes}
          setNotes={setNextNotes}
          onPlanAhead={() => plan.propose()}
          planning={plan.running}
        />
      )}
    </div>
  );
}
