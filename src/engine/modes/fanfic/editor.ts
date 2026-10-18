// ──────────────────────────────────────────────
// Fanfic editor pass: story-level notes per chapter, then rewrites of only the scenes that need it
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { effectiveMaxContext } from "../../generation/context-window";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { parseJsonObject } from "../../core/json";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import { locateFanficPassage } from "./continuity";
import { fanficChapterTextKey, fanficLedgerStatus, readFanficLedger, type FanficLedgerProgress } from "./ledger";
import {
  completeFanficJson,
  fanficCallBudget,
  fanficMessageChars,
  FanficReplyParseError,
  parseFanficJsonReply,
  loadFanficConnection,
} from "./llm-json";
import {
  loadFanficChapterForEdit,
  rewriteFanficPassageText,
  saveFanficPassageEdits,
  type FanficPassageSpan,
} from "./passage";
import { renderFanficRequestForPrompt } from "./prompts";
import { readFanficState } from "./request";

/**
 * What the pass scores, drawn from where AI fiction reads as AI (StoryScope, Chakrabarty et al. CHI 2025): stakes that
 * don't build, a single tidy plotline, few costly or ambiguous choices, themes explained out loud, and exposition.
 */
export const FANFIC_EDITOR_DIMENSIONS = ["escalation", "subplot", "choices", "theme", "exposition"] as const;
export type FanficEditorDimension = (typeof FANFIC_EDITOR_DIMENSIONS)[number];

export const FANFIC_EDITOR_LABELS: Record<FanficEditorDimension, string> = {
  escalation: "Stakes build",
  subplot: "Second thread",
  choices: "Hard choices",
  theme: "Shows its theme",
  exposition: "Lean exposition",
};

const DIMENSION_GUIDE: Record<FanficEditorDimension, string> = {
  escalation:
    "Stakes build: pressure, risk, or cost rises over the chapter before, or the chapter turns something. Low when it plays the same note at the same pitch (a common failing of model-written fiction: flat escalation).",
  subplot:
    "Second thread: something besides the main line moves (a side relationship, a secondary goal, a complication from elsewhere). Low when everything serves one tidy line.",
  choices:
    "Hard choices: someone chooses under pressure, gives something up, or does something morally gray with consequences. Low when choices are free, obvious, or undone right away.",
  theme:
    "Shows its theme: meaning and feelings come through action and dialogue. Low when characters or the narrator explain what the scene means, name the feelings it already showed, or end on a moral.",
  exposition:
    "Lean exposition: backstory and explanation only where the reader needs it. Low for recaps, info-dumps, or explaining what the reader can infer.",
};

const REPORT_MAX_TOKENS = 3000;
const FLAGS_PER_CHAPTER = 3;
const PREVIOUS_TAIL_CHARS = 4000;
/** A scene longer than this is too much to rewrite in one go. */
const MAX_SCENE_CHARS = 12_000;
const CONCURRENCY = 3;
const WRITE_ATTEMPTS = 5;
const EDITOR_VERSION = 1;

export class FanficEditorParseError extends FanficReplyParseError {
  constructor(detail: string) {
    super(`The editor's notes could not be read (${detail}).`);
    this.name = "FanficEditorParseError";
  }
}

export interface FanficEditorFlag {
  dimension: FanficEditorDimension;
  /** First words of the scene, copied from the chapter. */
  startQuote: string;
  /** Last words of the scene, copied from the chapter. */
  endQuote: string;
  problem: string;
  /** What a rewrite of the scene should do. */
  direction: string;
}

export interface FanficEditorReport {
  chapter: number;
  messageId: string;
  /** The chapter text the notes were written for; a rewrite makes them stale. */
  textKey: string;
  /** 0-10, higher is better. */
  scores: Record<FanficEditorDimension, number>;
  notes: Record<FanficEditorDimension, string>;
  flags: FanficEditorFlag[];
  /** Flagged scenes whose quotes couldn't be found exactly once in the chapter. */
  dropped: number;
}

/** Stored on the chat as `metadata.fanficEditor`, one report per chapter message. */
export interface FanficEditorStore {
  version: 1;
  reports: FanficEditorReport[];
}

// ── Prompt ──────────────────────────────────────

export function buildFanficEditorMessages(args: {
  state: FanficState;
  chapter: FanficChapterRef;
  /** Chapter summaries from the story ledger, or the end of the chapter before when there's no ledger. */
  storySoFar: string;
}): LlmMessage[] {
  const n = args.chapter.number;
  const plan = args.state.outline?.chapters.find((entry) => entry.number === n);
  const system = [
    `You are a developmental editor reading chapter ${n} of a requested fanfic. Judge the storytelling, not the sentences: how the chapter builds, what it risks, and what it explains that it should show.`,
    "## Score each from 0 to 10 (10 is best)",
    FANFIC_EDITOR_DIMENSIONS.map((dimension) => `- ${dimension}: ${DIMENSION_GUIDE[dimension]}`).join("\n"),
    "Judge against what this chapter is for in this request: a cozy fic doesn't need a body count, but it still needs something to turn. Don't reward length or penalize the rating's content.",
    "## Flag the scenes worth rewriting",
    `For any dimension scored 5 or lower, flag the scene where it shows most, at most ${FLAGS_PER_CHAPTER} flags in all. A scene is a stretch of a few paragraphs (under 1,500 words). Give its first words and its last words, each copied character for character from the chapter (8 to 20 words), the problem in one sentence, and a direction: what a rewrite of that scene should do, concretely, keeping what the scene must do for the plot.`,
    "## Reply format",
    `Reply with JSON only: {"scores": {${FANFIC_EDITOR_DIMENSIONS.map((d) => `"${d}": number`).join(", ")}}, "notes": {${FANFIC_EDITOR_DIMENSIONS.map((d) => `"${d}": string`).join(", ")}}, "flags": [{"dimension": string, "start": string, "end": string, "problem": string, "direction": string}]}`,
    "Each note is one sentence on why the chapter got that score.",
    `## The request\n${renderFanficRequestForPrompt({ ...args.state.request, styleNotes: "" })}`,
    plan ? `## What the outline planned for chapter ${n}\n${plan.title}: ${plan.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const user = [
    args.storySoFar.trim() ? `## The story so far\n${args.storySoFar.trim()}` : "",
    `## Chapter ${n}\n\n${args.chapter.content.trim()}`,
    `Score chapter ${n} and flag its scenes now.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Parsing and grounding ───────────────────────

function score(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 10 ? Math.round(number * 10) / 10 : null;
}

/** Where a flagged scene sits in the chapter: from its first quote to its last, each found exactly once. */
export function locateFanficScene(text: string, flag: Pick<FanficEditorFlag, "startQuote" | "endQuote">) {
  const start = locateFanficPassage(text, flag.startQuote);
  const end = locateFanficPassage(text, flag.endQuote);
  if (!start || !end || end.end <= start.start || end.end - start.start > MAX_SCENE_CHARS) return null;
  return { start: start.start, end: end.end } satisfies FanficPassageSpan;
}

export function parseFanficEditorReply(
  raw: string,
  chapter: FanficChapterRef,
): Omit<FanficEditorReport, "messageId" | "textKey" | "chapter"> {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !isRecord(parsed.scores)) throw new FanficEditorParseError("no scores");
  const scores = {} as Record<FanficEditorDimension, number>;
  const notes = {} as Record<FanficEditorDimension, string>;
  const rawNotes = isRecord(parsed.notes) ? parsed.notes : {};
  for (const dimension of FANFIC_EDITOR_DIMENSIONS) {
    const value = score(parsed.scores[dimension]);
    if (value === null) throw new FanficEditorParseError(`no 0-10 score for ${dimension}`);
    scores[dimension] = value;
    notes[dimension] = readString(rawNotes[dimension]).trim().slice(0, 500);
  }
  const flags: FanficEditorFlag[] = [];
  let dropped = 0;
  const placed: FanficPassageSpan[] = [];
  for (const item of Array.isArray(parsed.flags) ? parsed.flags : []) {
    if (!isRecord(item)) continue;
    const dimension = FANFIC_EDITOR_DIMENSIONS.find((value) => value === readString(item.dimension).trim());
    const flag = {
      dimension: dimension ?? "escalation",
      startQuote: readString(item.start).trim(),
      endQuote: readString(item.end).trim(),
      problem: readString(item.problem).trim().slice(0, 400),
      direction: readString(item.direction).trim().slice(0, 600),
    };
    const span = dimension && flag.direction ? locateFanficScene(chapter.content, flag) : null;
    // Overlapping scenes would fight over the same text in a rewrite: keep the first.
    if (!span || placed.some((other) => span.start < other.end && other.start < span.end)) {
      dropped += 1;
      continue;
    }
    placed.push(span);
    flags.push(flag);
    if (flags.length >= FLAGS_PER_CHAPTER) break;
  }
  return { scores, notes, flags, dropped };
}

// ── Storage ─────────────────────────────────────

function isReport(value: unknown): value is FanficEditorReport {
  if (!isRecord(value) || !Number.isInteger(value.chapter) || !isRecord(value.scores) || !isRecord(value.notes)) {
    return false;
  }
  const scores = value.scores;
  const notes = value.notes;
  return (
    typeof value.messageId === "string" &&
    typeof value.textKey === "string" &&
    FANFIC_EDITOR_DIMENSIONS.every((d) => typeof scores[d] === "number" && typeof notes[d] === "string") &&
    Array.isArray(value.flags) &&
    value.flags.every(
      (flag) =>
        isRecord(flag) &&
        FANFIC_EDITOR_DIMENSIONS.some((d) => d === flag.dimension) &&
        ["startQuote", "endQuote", "problem", "direction"].every((key) => typeof flag[key] === "string"),
    ) &&
    typeof value.dropped === "number"
  );
}

function rawStore(metadata: unknown): unknown {
  return parseJsonObject(metadata).fanficEditor ?? null;
}

export function readFanficEditorStore(metadata: unknown): FanficEditorStore {
  const raw = rawStore(metadata);
  const reports = isRecord(raw) && raw.version === EDITOR_VERSION && Array.isArray(raw.reports) ? raw.reports : [];
  return { version: EDITOR_VERSION, reports: reports.filter(isReport) };
}

/** Saves one chapter's report (replacing its old one, dropping reports for chapters no longer in the fic). */
async function saveReport(
  storage: StorageGateway,
  chatId: string,
  report: FanficEditorReport,
  liveMessageIds: ReadonlySet<string>,
): Promise<void> {
  const update = storage.updateChatIfUnchanged;
  if (!update) throw new Error("This runtime can't save editor notes safely.");
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const chat = await storage.get("chats", chatId);
    if (!isRecord(chat)) throw new Error("Chat was not found.");
    const raw = rawStore(chat.metadata);
    const reports = readFanficEditorStore(chat.metadata).reports.filter(
      (entry) => entry.messageId !== report.messageId && liveMessageIds.has(entry.messageId),
    );
    const next: FanficEditorStore = {
      version: EDITOR_VERSION,
      reports: [...reports, report].sort((a, b) => a.chapter - b.chapter),
    };
    const { updated } = await update.call(
      storage,
      chatId,
      { metadata: { fanficEditor: raw } },
      { metadata: { fanficEditor: next } },
    );
    if (updated) return;
  }
  throw new Error("The editor notes kept changing while saving. Try again.");
}

// ── Running ─────────────────────────────────────

function storySoFar(chapters: FanficChapterRef[], chapter: FanficChapterRef, metadata: unknown): string {
  const fresh = fanficLedgerStatus(readFanficLedger(metadata), chapters).fresh.slice(0, chapter.number - 1);
  if (fresh.length === chapter.number - 1 && fresh.length > 0) {
    return fresh.map((entry) => `Chapter ${entry.chapter}: ${entry.summary}`).join("\n");
  }
  const previous = chapters[chapter.number - 2];
  return previous ? `The end of chapter ${previous.number}:\n…${previous.content.slice(-PREVIOUS_TAIL_CHARS)}` : "";
}

export interface RunFanficEditorPassInput {
  chatId: string;
  connectionId?: string | null;
  /** Only these chapters; default every chapter without a current report. */
  messageIds?: string[];
}

/**
 * Scores each chapter that has no current report (or the ones named) on the five story dimensions and flags scenes to
 * rewrite. Reports save as they arrive, so a stopped pass keeps what it finished.
 */
export async function runFanficEditorPass(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: RunFanficEditorPassInput,
  options: { signal?: AbortSignal; onProgress?: (progress: FanficLedgerProgress) => void } = {},
): Promise<FanficEditorStore> {
  const { signal, onProgress } = options;
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("The editor pass only runs for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw new Error("Fill in the fanfic request first.");
  const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
  if (!connectionId || connectionId === "random") throw new Error("Pick a connection for the editor pass.");
  const connection = await loadFanficConnection(deps.storage, connectionId);
  if (!isRecord(connection)) throw new Error("The connection was not found.");
  const window = effectiveMaxContext(connection, {});

  const messages = (await deps.storage.listChatMessages<JsonRecord>(input.chatId)).filter(isRecord);
  const chapters = fanficChapterRefs(messages);
  const live = new Set(chapters.map((chapter) => chapter.messageId));
  const current = new Map(readFanficEditorStore(chat.metadata).reports.map((report) => [report.messageId, report]));
  const todo = chapters.filter((chapter) =>
    input.messageIds?.length
      ? input.messageIds.includes(chapter.messageId)
      : current.get(chapter.messageId)?.textKey !== fanficChapterTextKey(chapter.content),
  );
  let done = 0;
  onProgress?.({ done, total: todo.length });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const chapter = todo[next++]!;
      const prompt = buildFanficEditorMessages({
        state,
        chapter,
        storySoFar: storySoFar(chapters, chapter, chat.metadata),
      });
      const budget = fanficCallBudget(window, {
        maxReplyTokens: REPORT_MAX_TOKENS,
        fixedChars: fanficMessageChars(prompt),
        defaultChars: 0,
        what: `the editor pass on chapter ${chapter.number}`,
      });
      const parsed = await completeFanficJson(
        deps.llm,
        { connectionId, messages: prompt, maxTokens: budget.replyTokens },
        (raw) => parseFanficEditorReply(raw, chapter),
        signal,
      );
      await saveReport(
        deps.storage,
        input.chatId,
        {
          ...parsed,
          chapter: chapter.number,
          messageId: chapter.messageId,
          textKey: fanficChapterTextKey(chapter.content),
        },
        live,
      );
      done += 1;
      onProgress?.({ done, total: todo.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  const latest = await deps.storage.get("chats", input.chatId);
  return readFanficEditorStore(isRecord(latest) ? latest.metadata : null);
}

/**
 * Rewrites only the flagged scenes of one chapter, each with its direction and the text around it, and saves the
 * result as a new version of the chapter (the scored version stays one tap back). Refuses when the chapter changed
 * since its report.
 */
export async function rewriteFanficFlaggedScenes(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { chatId: string; report: FanficEditorReport; flags?: FanficEditorFlag[]; connectionId?: string | null },
  options: { signal?: AbortSignal; onProgress?: (progress: FanficLedgerProgress) => void } = {},
): Promise<{ rewritten: number; skipped: number; textKey: string }> {
  const { signal, onProgress } = options;
  const target = await loadFanficChapterForEdit(deps.storage, {
    chatId: input.chatId,
    messageId: input.report.messageId,
    textKey: input.report.textKey,
    connectionId: input.connectionId,
  });
  const flags = input.flags ?? input.report.flags;
  if (flags.length === 0) throw new Error("This chapter has no flagged scenes.");
  const text = target.chapter.content;
  const placed = flags
    .map((flag) => ({ flag, span: locateFanficScene(text, flag) }))
    .filter((entry): entry is { flag: FanficEditorFlag; span: FanficPassageSpan } => entry.span !== null);
  const skipped = flags.length - placed.length;
  if (placed.length === 0) throw new Error("None of the flagged scenes could be found in the chapter.");
  const edits: Array<FanficPassageSpan & { text: string }> = [];
  onProgress?.({ done: 0, total: placed.length });
  for (const { flag, span } of placed) {
    const instruction = `${FANFIC_EDITOR_LABELS[flag.dimension]}: ${flag.problem} ${flag.direction}`;
    const rewritten = await rewriteFanficPassageText(deps.llm, target, text, span, instruction, signal);
    edits.push({ ...span, text: rewritten });
    onProgress?.({ done: edits.length, total: placed.length });
  }
  const { textKey } = await saveFanficPassageEdits(deps.storage, { chatId: input.chatId, target, edits });
  return { rewritten: edits.length, skipped, textKey };
}
