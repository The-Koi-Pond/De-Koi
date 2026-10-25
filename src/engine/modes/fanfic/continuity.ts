// ──────────────────────────────────────────────
// Fanfic continuity check: one chapter against everything before it
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type {
  FanficContinuityCategory,
  FanficContinuityIssue,
  FanficLedger,
  FanficLedgerEntry,
  FanficModelRecord,
  FanficRequest,
} from "../../contracts/types/fanfic";
import { FANFIC_CONTINUITY_CATEGORIES } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { effectiveMaxContext } from "../../generation/context-window";
import { assertNoFanficUnfinishedChapter, fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import {
  fanficChapterTextKey,
  fanficLedgerStatus,
  readFanficLedger,
  renderFanficLedgerState,
  updateFanficLedger,
} from "./ledger";
import {
  completeFanficJson,
  fanficCallBudget,
  fanficMessageChars,
  FanficWindowTooSmallError,
  parseFanficJsonReply,
  type FanficCallBudget,
  FANFIC_CONNECTION_GONE,
  noteFanficHelperRun,
  pickFanficHelperConnection,
} from "./llm-json";
import { renderFanficRequestForPrompt, stripFanficChapterHeading } from "./prompts";
import { fanficModelRecord, fanficRewrittenVersion } from "./versions";
import {
  confirmedFanficContinuityIssues,
  FANFIC_CONTINUITY_CATEGORY_LABELS,
  FANFIC_CONTINUITY_SUBTYPES,
  FANFIC_CONTINUITY_SWEEPS,
  FanficQualityParseError,
  fanficQualityRatingNote,
  fanficSamePassage,
  fanficSearchableText,
  fanficTextHolds,
  parseFanficContinuityVerdicts,
  readFanficContinuityIssue,
} from "./quality";
import { readFanficState } from "./request";
import { userFacingError } from "../../shared/user-facing-error";

/** Earlier prose sent with the chapter when the window allows: about 150k tokens, well past most fics. */
const MAX_EARLIER_CHARS = 600_000;
/** Recent chapters kept in full when the rest has to come from the ledger. */
const RECENT_CHAPTERS = 2;
const SWEEP_MAX_TOKENS = 6000;
const VERIFY_MAX_TOKENS = 4000;
const MAX_ISSUES = 8;

/** The smallest change to the checked chapter that removes a contradiction. */
export interface FanficContinuityFix {
  /** Text copied from the chapter. */
  find: string;
  replace: string;
}

export interface FanficChapterContinuityIssue extends FanficContinuityIssue {
  /** 0 when the earlier fact comes from the story ledger rather than a chapter the judge read in full. */
  earlierChapter: number;
  fix: FanficContinuityFix | null;
}

export interface FanficChapterContinuityCheck {
  chapter: number;
  messageId: string;
  /** Fingerprint of the chapter text that was checked; fixes only apply to that text. */
  textKey: string;
  /** "ledger" when the oldest chapters were too long to send and the ledger stood in for them. */
  basis: "chapters" | "ledger";
  /** Chapters read in full besides the one checked. */
  chaptersRead: number[];
  issues: FanficChapterContinuityIssue[];
  candidates: number;
  ungrounded: number;
  rejected: number;
  merged: number;
  /** The model that ran the check and wrote its fixes; a version saved from them credits it. */
  model: FanficModelRecord;
}

export type FanficContinuityPhase = "updating_ledger" | "checking" | "verifying";

// ── What the judge reads ────────────────────────

interface CheckContext {
  target: FanficChapterRef;
  earlier: FanficChapterRef[];
  /** Ledger state through the last chapter left out, when some were. */
  ledgerNote: string;
  ledgerThrough: number;
}

function renderChapters(chapters: readonly FanficChapterRef[]): string {
  return chapters.map((chapter) => `### Chapter ${chapter.number}\n\n${chapter.content.trim()}`).join("\n\n");
}

function storyBlock(context: CheckContext): string {
  const parts: string[] = [];
  if (context.ledgerNote) {
    parts.push(
      `## Story ledger through chapter ${context.ledgerThrough}\nThe earlier chapters are too long to include, so these are the facts kept from them.\n\n${context.ledgerNote}`,
    );
  }
  if (context.earlier.length > 0) parts.push(`## Earlier chapters\n\n${renderChapters(context.earlier)}`);
  parts.push(`## Chapter ${context.target.number} (the chapter to check)\n\n${context.target.content.trim()}`);
  return parts.join("\n\n");
}

function requestBlock(request: FanficRequest, chapterCount: number): string {
  return renderFanficRequestForPrompt({
    ...request,
    styleNotes: "",
    chapterCount: Math.max(request.chapterCount, chapterCount),
  });
}

function buildFanficChapterContinuityMessages(args: {
  request: FanficRequest;
  context: CheckContext;
  categories?: readonly FanficContinuityCategory[];
}): LlmMessage[] {
  const n = args.context.target.number;
  const focus = args.categories?.length ? args.categories : FANFIC_CONTINUITY_CATEGORIES;
  const ledgerSource = args.context.ledgerNote
    ? " When the earlier fact is only in the story ledger, set earlierChapter to 0 and quote the ledger line."
    : "";
  const system = [
    `You are a continuity editor checking chapter ${n} of a fic against everything before it. Find places where chapter ${n} contradicts an earlier chapter or itself: two passages that cannot both be true in the story as written. Track the facts through the earlier chapters, then read chapter ${n} closely.`,
    fanficQualityRatingNote(args.request),
    focus.length < FANFIC_CONTINUITY_CATEGORIES.length
      ? "## What counts (this pass looks only for these; another pass covers the rest)"
      : "## What counts",
    focus
      .map(
        (category) =>
          `- ${category} (${FANFIC_CONTINUITY_CATEGORY_LABELS[category]}): ${FANFIC_CONTINUITY_SUBTYPES[category]}`,
      )
      .join("\n"),
    "## What does not count",
    "- Things the story explains (a wound that heals over weeks, a character who lies, a dream, a deliberate twist).",
    "- Gaps, vagueness, or things that merely seem unlikely; only real contradictions.",
    "- Deviations from canon the request asked for (alternate universe, canon divergence).",
    "- Contradictions only between earlier chapters: report only ones that involve chapter " + n + ".",
    "- Style complaints, repetition, or quality judgments.",
    "## Reply format",
    `Reply with JSON only: {"issues": [{"category": string, "subtype": string, "earlierChapter": number, "earlierQuote": string, "laterQuote": string, "explanation": string, "fix": {"find": string, "replace": string} | null}]}`,
    `- category is one of: ${focus.join(", ")}. subtype is a few words, e.g. \`injury vanishes\`.`,
    `- laterQuote is from chapter ${n}. earlierQuote is from an earlier chapter, or from chapter ${n} itself when the chapter contradicts itself; earlierChapter says which.${ledgerSource}`,
    "- Each quote is copied character for character, 5 to 30 words, enough to find the passage. Never paraphrase. explanation is one sentence saying why both can't be true.",
    `- fix is the smallest edit to chapter ${n} that removes the contradiction and keeps the earlier fact: find is a phrase or sentence copied character for character from chapter ${n}, and replace is what it should say instead, in the same voice. Change only what the contradiction needs. Use null when it would take more than a couple of sentences.`,
    `- List at most ${MAX_ISSUES} issues, most serious first. If there are none, reply {"issues": []}.`,
    `## The request\n${requestBlock(args.request, n)}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${storyBlock(args.context)}\n\nList the contradictions in chapter ${n} now.` },
  ];
}

function buildFanficChapterVerifyMessages(args: {
  request: FanficRequest;
  context: CheckContext;
  issues: FanficChapterContinuityIssue[];
}): LlmMessage[] {
  const n = args.context.target.number;
  const notes = args.issues
    .map((issue, index) => {
      const source = issue.earlierChapter === 0 ? "The story ledger" : `Chapter ${issue.earlierChapter}`;
      return `${index + 1}. ${source}: "${issue.earlierQuote}" vs chapter ${n}: "${issue.laterQuote}". Claimed: ${issue.explanation}`;
    })
    .join("\n");
  const system = [
    `You double-check a continuity editor's notes on chapter ${n} of a fic. For each numbered note, reread the text around both passages and decide whether they truly contradict each other.`,
    "A note is a real contradiction only when both passages cannot be true in the story as written. It is not one when the fic explains it elsewhere, when time passes enough to account for it, when a character lies or misremembers on purpose, or when the note misreads the passage.",
    'Reply with JSON only: {"verdicts": [{"note": number, "reason": string, "contradiction": boolean, "sameAs": number | null}]}, exactly one entry per note. Write reason first: one sentence on what the text actually says around both passages. Then decide.',
    "Two notes can describe the same contradiction while quoting different lines. When a note repeats an earlier note's contradiction, set sameAs to that earlier note's number; otherwise sameAs is null.",
    `## The notes\n${notes}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${storyBlock(args.context)}\n\nCheck every note now.` },
  ];
}

// ── Parsing ─────────────────────────────────────

function readFix(value: unknown): FanficContinuityFix | null {
  if (!isRecord(value)) return null;
  const find = readString(value.find).trim();
  const replace = readString(value.replace).trim();
  if (!find || find === replace) return null;
  return { find: find.slice(0, 1200), replace: replace.slice(0, 1600) };
}

/** Candidates for the checked chapter; a broken entry makes the whole reply a bad reply (retried). */
export function parseFanficChapterContinuityReply(raw: string, chapter: number): FanficChapterContinuityIssue[] {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.issues)) throw new FanficQualityParseError("continuity", raw);
  return parsed.issues.map((item) => ({
    // earlierChapter reads as 0 when it's missing or names the ledger; grounding settles which chapter holds it.
    ...readFanficContinuityIssue(item, raw),
    laterChapter: chapter,
    fix: readFix(isRecord(item) ? item.fix : null),
  }));
}

// ── Grounding ───────────────────────────────────

function holds(text: string, quote: string): boolean {
  return fanficSearchableText(quote).split(" ").length >= 3 && fanficTextHolds(text, quote);
}

/**
 * Keeps candidates whose quotes are really there: the later quote in the checked chapter, the earlier one in the
 * chapter it names (or any chapter read, renumbered), or in the ledger when one stood in. Drops exact repeats.
 */
function groundFanficChapterIssues(
  issues: FanficChapterContinuityIssue[],
  context: CheckContext,
): { grounded: FanficChapterContinuityIssue[]; dropped: number; repeats: number } {
  const grounded: FanficChapterContinuityIssue[] = [];
  let dropped = 0;
  let repeats = 0;
  const read = [...context.earlier, context.target];
  for (const issue of issues) {
    if (!holds(context.target.content, issue.laterQuote)) {
      dropped += 1;
      continue;
    }
    let earlierChapter = -1;
    const named = read.find((chapter) => chapter.number === issue.earlierChapter);
    if (named && holds(named.content, issue.earlierQuote)) earlierChapter = named.number;
    else {
      const found = read.find((chapter) => holds(chapter.content, issue.earlierQuote));
      if (found) earlierChapter = found.number;
      else if (context.ledgerNote && holds(context.ledgerNote, issue.earlierQuote)) earlierChapter = 0;
    }
    if (earlierChapter < 0 || fanficSearchableText(issue.earlierQuote) === fanficSearchableText(issue.laterQuote)) {
      dropped += 1;
      continue;
    }
    const placed = {
      ...issue,
      earlierChapter,
      fix: issue.fix && locateFanficPassage(context.target.content, issue.fix.find) ? issue.fix : null,
    };
    const kept = grounded.find(
      (entry) =>
        entry.category === placed.category &&
        fanficSamePassage(entry.earlierQuote, placed.earlierQuote) &&
        fanficSamePassage(entry.laterQuote, placed.laterQuote),
    );
    if (kept) {
      repeats += 1;
      // The repeat may be the one that came with a usable fix.
      kept.fix ??= placed.fix;
    } else grounded.push(placed);
  }
  return { grounded, dropped, repeats };
}

// ── Fixes ───────────────────────────────────────

/** Letters and digits in any script. An apostrophe between two of them (he's, don’t) is inside the word. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const APOSTROPHE = /['’]/;
const isWord = (char: string | undefined) => WORD_CHAR.test(char ?? "");

/** The whole character (code point) that starts at `index`, or "" outside the text. */
function charFrom(text: string, index: number): string {
  const code = index >= 0 ? text.codePointAt(index) : undefined;
  return code === undefined ? "" : String.fromCodePoint(code);
}

/** The whole character (code point) that ends just before `index`, and where it starts. */
function charBefore(text: string, index: number): { char: string; at: number } {
  if (index <= 0) return { char: "", at: 0 };
  const low = text.charCodeAt(index - 1);
  const at = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return { char: charFrom(text, at), at };
}

/** The span neither starts in the middle of a word nor ends in one. Works in code points, so astral letters count. */
function wholeWordsAt(text: string, start: number, end: number): boolean {
  const before = charBefore(text, start);
  const cutsStart =
    isWord(charFrom(text, start)) &&
    (isWord(before.char) || (APOSTROPHE.test(before.char) && isWord(charBefore(text, before.at).char)));
  const after = charFrom(text, end);
  const cutsEnd =
    isWord(charBefore(text, end).char) &&
    (isWord(after) || (APOSTROPHE.test(after) && isWord(charFrom(text, end + after.length))));
  return !cutsStart && !cutsEnd;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where `find` sits in the chapter, matching through curly quotes, italics markers, and line breaks. Null unless it
 * occurs exactly once, so a fix never lands on the wrong passage.
 */
export function locateFanficPassage(text: string, find: string): { start: number; end: number } | null {
  if (!find) return null;
  const exact: number[] = [];
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + 1)) {
    if (wholeWordsAt(text, at, at + find.length)) exact.push(at);
  }
  if (exact.length > 1) return null;
  if (exact.length === 1) return { start: exact[0]!, end: exact[0]! + find.length };
  const words = find.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu);
  if (!words || words.length < 3) return null;
  // Whole words only: the first and last word can't be the tail or head of a longer one (contractions included).
  // Combining marks (an accent typed as its own character) belong to the letter before them.
  const pattern = `(?<![\\p{L}\\p{M}\\p{N}]|[\\p{L}\\p{M}\\p{N}]['’])${words
    .map((word) => escapeRegex(word).replace(/['’]/g, "['’]"))
    .join("[^\\p{L}\\p{M}\\p{N}]+")}(?![\\p{L}\\p{M}\\p{N}]|['’][\\p{L}\\p{M}\\p{N}])`;
  const matches = [...text.matchAll(new RegExp(pattern, "giu"))];
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  return { start: match.index!, end: match.index! + match[0].length };
}

/**
 * The chapter with each fix applied, in order. A fix whose passage is gone or overlaps one already applied is skipped
 * and reported, never applied somewhere else.
 */
export function applyFanficContinuityFixes(
  text: string,
  fixes: readonly FanficContinuityFix[],
): { text: string; applied: number; skipped: number; appliedIndexes: number[] } {
  let result = text;
  let applied = 0;
  let skipped = 0;
  const appliedIndexes: number[] = [];
  const edited: Array<{ start: number; end: number }> = [];
  for (const [index, fix] of fixes.entries()) {
    const span = locateFanficPassage(result, fix.find);
    if (!span || edited.some((range) => span.start < range.end && range.start < span.end)) {
      skipped += 1;
      continue;
    }
    result = `${result.slice(0, span.start)}${fix.replace}${result.slice(span.end)}`;
    const shift = fix.replace.length - (span.end - span.start);
    for (const range of edited) {
      if (range.start >= span.end) {
        range.start += shift;
        range.end += shift;
      }
    }
    edited.push({ start: span.start, end: span.start + fix.replace.length });
    applied += 1;
    appliedIndexes.push(index);
  }
  return { text: result, applied, skipped, appliedIndexes };
}

/**
 * Saves the fixed chapter as a new version of the same message (the checked version stays one tap back). Refuses when
 * the chapter changed since the check, since the fixes were written for that text. Returns which fixes landed and the
 * new text's fingerprint, so the slips left over stay fixable against it.
 */
export async function applyFanficContinuityFixesToChapter(
  storage: StorageGateway,
  input: {
    chatId: string;
    check: Pick<FanficChapterContinuityCheck, "messageId" | "textKey" | "model">;
    fixes: FanficContinuityFix[];
  },
): Promise<{ applied: number; skipped: number; appliedIndexes: number[]; textKey: string }> {
  const messages = await storage.listChatMessages<JsonRecord>(input.chatId);
  assertNoFanficUnfinishedChapter(messages.filter(isRecord));
  const message = messages.filter(isRecord).find((entry) => readString(entry.id) === input.check.messageId);
  const chapter = fanficChapterRefs(messages.filter(isRecord)).find(
    (entry) => entry.messageId === input.check.messageId,
  );
  if (!message || !chapter) throw userFacingError("That chapter is no longer in this fic.");
  if (fanficChapterTextKey(chapter.content) !== input.check.textKey) {
    throw userFacingError("The chapter changed since the check. Check it again before fixing.");
  }
  const result = applyFanficContinuityFixes(readString(message.content), input.fixes);
  if (result.applied === 0)
    throw userFacingError(
      "None of the fixes could be placed in the chapter. The chapter may have changed; run the check again.",
    );
  // The fixes' wording came from the model that ran the check, so the new version credits it.
  await storage.addChatMessageSwipe(input.chatId, input.check.messageId, result.text, {
    activate: true,
    extra: { fanficVersion: fanficRewrittenVersion(message, input.check.model, "") },
  });
  return {
    applied: result.applied,
    skipped: result.skipped,
    appliedIndexes: result.appliedIndexes,
    textKey: fanficChapterTextKey(stripFanficChapterHeading(result.text)),
  };
}

// ── Running ─────────────────────────────────────

/** Section headings and the ledger's framing line around the earlier text. */
const STORY_FRAME_CHARS = 400;
/** The double-check also lists every note (at most MAX_ISSUES, each a few quoted lines). */
const VERIFY_NOTES_CHARS = MAX_ISSUES * 700;

/**
 * Room for earlier chapters (or the ledger) beside everything else the check sends: its instructions and the request,
 * measured from the real prompt, the checked chapter, the double-check's notes, and the reply.
 */
function checkBudget(connection: JsonRecord, request: FanficRequest, target: FanficChapterRef): FanficCallBudget {
  const frame = buildFanficChapterContinuityMessages({
    request,
    context: { target, earlier: [], ledgerNote: "", ledgerThrough: 0 },
  });
  return fanficCallBudget(effectiveMaxContext(connection, {}), {
    maxReplyTokens: SWEEP_MAX_TOKENS,
    fixedChars: fanficMessageChars(frame) + STORY_FRAME_CHARS + VERIFY_NOTES_CHARS,
    defaultChars: MAX_EARLIER_CHARS,
    maxChars: MAX_EARLIER_CHARS,
    what: `checking chapter ${target.number}`,
  });
}

function ledgerNoteThrough(fresh: readonly FanficLedgerEntry[], through: number): string {
  const summaries = fresh
    .slice(0, through)
    .map((item) => `Chapter ${item.chapter}: ${item.summary}`)
    .join("\n");
  return `${renderFanficLedgerState(fresh[through - 1]!)}\n\n${summaries}`;
}

function contextFor(
  chapters: FanficChapterRef[],
  target: FanficChapterRef,
  ledger: FanficLedger,
  budget: number,
): CheckContext | "needs_ledger" | "too_small" {
  const earlier = chapters.slice(0, target.number - 1);
  const size = (list: readonly FanficChapterRef[]) => list.reduce((sum, chapter) => sum + chapter.content.length, 0);
  if (size(earlier) <= budget) return { target, earlier, ledgerNote: "", ledgerThrough: 0 };
  const fresh = fanficLedgerStatus(ledger, chapters).fresh;
  // As many recent chapters in full as fit beside the ledger note for the rest, fewest-ledger first.
  for (let count = Math.min(RECENT_CHAPTERS, earlier.length - 1); count >= 0; count -= 1) {
    const through = earlier.length - count;
    if (!fresh[through - 1]) return "needs_ledger";
    const recent = earlier.slice(through);
    const ledgerNote = ledgerNoteThrough(fresh, through);
    if (size(recent) + ledgerNote.length <= budget)
      return { target, earlier: recent, ledgerNote, ledgerThrough: through };
  }
  return "too_small";
}

export interface CheckFanficChapterContinuityInput {
  chatId: string;
  messageId: string;
  /** Defaults to the fic's own connection. */
  connectionId?: string | null;
}

/**
 * Checks one chapter against the chapters before it: two focused sweeps for contradictions involving that chapter,
 * quotes checked against the text, then a second read that must rule on every note. Earlier chapters are read in full
 * when they fit the connection's window; otherwise the story ledger stands in for the oldest ones.
 */
export async function checkFanficChapterContinuity(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: CheckFanficChapterContinuityInput,
  options: { signal?: AbortSignal; onPhase?: (phase: FanficContinuityPhase) => void } = {},
): Promise<FanficChapterContinuityCheck> {
  const { signal, onPhase } = options;
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Continuity checks only run for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw userFacingError("Fill in the fanfic request first.");
  // Noted after any ledger update below, so the last run names this check, not the ledger it waited on.
  const pickInput = {
    chatId: input.chatId,
    connectionId: input.connectionId,
    job: "continuity check",
    missing: "Pick a connection for the continuity check.",
    gone: FANFIC_CONNECTION_GONE,
    note: false,
  };
  const pick = await pickFanficHelperConnection(deps.storage, "fanficChecks", chat, pickInput);
  const { connectionId, connection } = pick;
  if (!connection) throw userFacingError(pickInput.missing);

  const messages = await deps.storage.listChatMessages<JsonRecord>(input.chatId);
  const chapters = fanficChapterRefs(messages.filter(isRecord));
  const target = chapters.find((chapter) => chapter.messageId === input.messageId);
  if (!target) throw userFacingError("That chapter is no longer in this fic.");
  if (target.number === 1) throw userFacingError("Chapter 1 has nothing before it to contradict.");

  const budget = checkBudget(connection, state.request, target);
  let context = contextFor(chapters, target, readFanficLedger(chat.metadata), budget.proseChars);
  if (context === "needs_ledger") {
    onPhase?.("updating_ledger");
    // The ledger makes the same pick itself, unless this check was handed a connection.
    const ledger = await updateFanficLedger(
      deps,
      { chatId: input.chatId, connectionId: pick.rule === "picked" ? connectionId : null },
      { signal },
    );
    context = contextFor(chapters, target, ledger, budget.proseChars);
    if (context === "needs_ledger")
      throw userFacingError("The story ledger couldn't cover the earlier chapters. Try the check again.");
  }
  if (context === "too_small") {
    throw new FanficWindowTooSmallError(`checking chapter ${target.number} against the story ledger`);
  }
  const checkContext = context;

  await noteFanficHelperRun(deps.storage, "fanficChecks", pickInput, pick);
  onPhase?.("checking");
  const sweeps = await Promise.all(
    FANFIC_CONTINUITY_SWEEPS.map((categories) =>
      completeFanficJson(
        deps.llm,
        {
          connectionId,
          messages: buildFanficChapterContinuityMessages({ request: state.request, context: checkContext, categories }),
          maxTokens: budget.replyTokens,
        },
        (raw) => parseFanficChapterContinuityReply(raw, target.number),
        signal,
      ),
    ),
  );
  const candidates = sweeps.flat();
  const { grounded, dropped, repeats } = groundFanficChapterIssues(candidates, checkContext);
  let confirmed: FanficChapterContinuityIssue[] = [];
  let merged = 0;
  if (grounded.length > 0) {
    onPhase?.("verifying");
    const verdicts = await completeFanficJson(
      deps.llm,
      {
        connectionId,
        messages: buildFanficChapterVerifyMessages({ request: state.request, context: checkContext, issues: grounded }),
        maxTokens: Math.min(VERIFY_MAX_TOKENS, budget.replyTokens),
      },
      (raw) => parseFanficContinuityVerdicts(raw, grounded.length),
      signal,
    );
    // A note folded into an earlier one hands over its fix when the earlier note has none.
    verdicts.sameAs.forEach((earlier, note) => {
      const target = grounded[earlier - 1];
      if (target && verdicts.confirmed.has(note) && verdicts.confirmed.has(earlier))
        target.fix ??= grounded[note - 1]?.fix ?? null;
    });
    const result = confirmedFanficContinuityIssues(grounded, verdicts);
    confirmed = result.confirmed;
    merged = result.merged;
  }
  return {
    chapter: target.number,
    messageId: target.messageId,
    textKey: fanficChapterTextKey(target.content),
    basis: checkContext.ledgerNote ? "ledger" : "chapters",
    chaptersRead: checkContext.earlier.map((chapter) => chapter.number),
    issues: confirmed,
    candidates: candidates.length,
    ungrounded: dropped,
    rejected: grounded.length - confirmed.length - merged,
    merged: merged + repeats,
    model: fanficModelRecord(connection),
  };
}
