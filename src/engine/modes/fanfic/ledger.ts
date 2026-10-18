// ──────────────────────────────────────────────
// Fanfic story ledger: the facts a writer keeps straight between chapters
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficLedger, FanficLedgerEntry, FanficLedgerFact, FanficRequest } from "../../contracts/types/fanfic";
import { parseJsonObject } from "../../core/json";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { effectiveMaxContext } from "../../generation/context-window";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import {
  completeFanficJson,
  fanficCallBudget,
  FanficReplyParseError,
  parseFanficJsonReply,
  type FanficCallBudget,
} from "./llm-json";
import { renderFanficRequestForPrompt } from "./prompts";
import { readFanficState } from "./request";

/** Bumped when the ledger prompt or entry shape changes; older ledgers are rebuilt. */
const FANFIC_LEDGER_VERSION = 1;

const LIST_LIMITS = { knowledge: 12, conditions: 12, relationships: 6, openThreads: 8 } as const;
const FIELD_CHARS = 400;
const SUMMARY_CHARS = 900;
/** Chapters read per ledger call. Bounds the reply size; a long backfill takes a few calls. */
const MAX_CHAPTERS_PER_CALL = 6;
/** Prose per ledger call when the connection's window is unknown or large (about 25k tokens). */
const DEFAULT_CHARS_PER_CALL = 100_000;
const LEDGER_MAX_TOKENS = 8000;
const WRITE_ATTEMPTS = 5;

export class FanficLedgerParseError extends FanficReplyParseError {
  constructor(detail: string) {
    super(`The story ledger reply could not be read (${detail}).`);
    this.name = "FanficLedgerParseError";
  }
}

// ── Fingerprint ─────────────────────────────────

/** FNV-1a over one chapter's text: a rewrite or a different version makes the entry stale. */
export function fanficChapterTextKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

// ── Reading the stored ledger ───────────────────

const isString = (value: unknown): value is string => typeof value === "string";

function isFact(value: unknown): value is FanficLedgerFact {
  return isRecord(value) && isString(value.subject) && isString(value.detail);
}

function isEntry(value: unknown): value is FanficLedgerEntry {
  return (
    isRecord(value) &&
    Number.isInteger(value.chapter) &&
    (value.chapter as number) >= 1 &&
    [value.messageId, value.textKey, value.summary, value.timeline].every(isString) &&
    [value.knowledge, value.conditions, value.relationships].every(
      (list) => Array.isArray(list) && list.every(isFact),
    ) &&
    Array.isArray(value.openThreads) &&
    value.openThreads.every(isString)
  );
}

function rawLedger(metadata: unknown): unknown {
  return parseJsonObject(metadata).fanficLedger ?? null;
}

/** The saved ledger, or an empty one when it's missing, from an older version, or out of order. */
export function readFanficLedger(metadata: unknown): FanficLedger {
  const raw = rawLedger(metadata);
  if (!isRecord(raw) || raw.version !== FANFIC_LEDGER_VERSION || !Array.isArray(raw.entries)) {
    return { version: FANFIC_LEDGER_VERSION, entries: [] };
  }
  const entries: FanficLedgerEntry[] = [];
  for (const entry of raw.entries) {
    if (!isEntry(entry) || entry.chapter !== entries.length + 1) break;
    entries.push(entry);
  }
  return { version: FANFIC_LEDGER_VERSION, entries };
}

export interface FanficLedgerStatus {
  /** Entries that still match their chapter's current text, in an unbroken run from chapter 1. */
  fresh: FanficLedgerEntry[];
  /** Chapters (1-based) with no fresh entry: rewritten, new, or after one that changed. */
  stale: number[];
}

/**
 * An entry is fresh while its chapter is the same message with the same text and every entry before it is fresh:
 * each one builds on the last, so a rewrite of chapter 3 makes 3 onward stale.
 */
export function fanficLedgerStatus(ledger: FanficLedger, chapters: readonly FanficChapterRef[]): FanficLedgerStatus {
  const fresh: FanficLedgerEntry[] = [];
  for (const chapter of chapters) {
    const entry = ledger.entries[chapter.number - 1];
    if (
      !entry ||
      entry.messageId !== chapter.messageId ||
      entry.textKey !== fanficChapterTextKey(chapter.content) ||
      fresh.length !== chapter.number - 1
    ) {
      break;
    }
    fresh.push(entry);
  }
  return { fresh, stale: chapters.slice(fresh.length).map((chapter) => chapter.number) };
}

// ── Prompt ──────────────────────────────────────

function factLines(facts: FanficLedgerFact[]): string[] {
  return facts.map((fact) => `- ${fact.subject}: ${fact.detail}`);
}

/** One entry's standing facts as markdown (no summary). */
export function renderFanficLedgerState(entry: FanficLedgerEntry): string {
  const sections: Array<[string, string[]]> = [
    ["When", entry.timeline ? [entry.timeline] : []],
    ["Facts, and who knows them", factLines(entry.knowledge)],
    ["Injuries, objects, and whereabouts", factLines(entry.conditions)],
    ["Relationships", factLines(entry.relationships)],
    ["Open threads", entry.openThreads.map((thread) => `- ${thread}`)],
  ];
  return sections
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `${title}:\n${lines.join("\n")}`)
    .join("\n");
}

function requestBlock(request: FanficRequest): string {
  // Style notes steer the prose, not the facts; leaving them out keeps the ledger reader on the facts.
  return renderFanficRequestForPrompt({ ...request, styleNotes: "" });
}

const ENTRY_SHAPE =
  '{"chapter": number, "summary": string, "timeline": string, "knowledge": [{"subject": string, "detail": string}], "conditions": [{"subject": string, "detail": string}], "relationships": [{"subject": string, "detail": string}], "openThreads": [string]}';

/** Messages asking for one ledger entry per chapter given, each building on the one before. */
export function buildFanficLedgerMessages(args: {
  request: FanficRequest;
  previous: FanficLedgerEntry | null;
  chapters: ReadonlyArray<{ number: number; content: string }>;
}): LlmMessage[] {
  const first = args.chapters[0]?.number ?? 1;
  const last = args.chapters[args.chapters.length - 1]?.number ?? first;
  const system = [
    "You keep the story ledger for a fanfic in progress: the facts the writer has to keep straight from chapter to chapter. For each chapter you're given, write down where things stand at the end of that chapter.",
    "Record only what the text establishes. Never add canon facts or guesses. Write claims, threats, and suspicions as what they are (Harlequin says he'll tell Doctor), not as facts. Keep every line short and concrete: names, numbers, objects, places, times, and name events rather than chapter numbers inside a fact.",
    [
      "Each entry has:",
      "- summary: 2-4 sentences on what happens in that chapter.",
      "- timeline: when the chapter ends, relative to the story's start and to the chapter before (for example: Night of day 2, a few hours after chapter 3).",
      "- knowledge: secrets, real names, plans, and revelations, saying who knows and who still doesn't. Carry forward what is still true.",
      "- conditions: injuries and how they're healing, what people are wearing when it matters, objects (who has what, where it is), counts that matter, and where characters are.",
      "- relationships: each pair that matters and where they stand now.",
      "- openThreads: promises, questions, and plans the story hasn't resolved yet. Drop the ones this chapter resolves.",
      `Keep at most ${LIST_LIMITS.knowledge} knowledge, ${LIST_LIMITS.conditions} conditions, ${LIST_LIMITS.relationships} relationships, and ${LIST_LIMITS.openThreads} open threads, keeping the ones most likely to matter later.`,
    ].join("\n"),
    `## The request\n${requestBlock(args.request)}`,
    args.previous
      ? `## Ledger after chapter ${args.previous.chapter}\n${renderFanficLedgerState(args.previous)}`
      : "## Ledger so far\nEmpty: start it from the first chapter below.",
  ].join("\n\n");
  const story = args.chapters.map((chapter) => `## Chapter ${chapter.number}\n${chapter.content.trim()}`).join("\n\n");
  const ask =
    first === last
      ? `Write the ledger entry for chapter ${first}.`
      : `Write one ledger entry for each of chapters ${first} to ${last}, in order. Each entry is the state at the end of its chapter, building on the entry before it.`;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${story}\n\n${ask}\nReply with JSON only, no prose around it: {"entries": [${ENTRY_SHAPE}]}`,
    },
  ];
}

// ── Parsing ─────────────────────────────────────

function text(value: unknown, limit = FIELD_CHARS): string {
  return readString(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function facts(value: unknown, limit: number, field: string): FanficLedgerFact[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new FanficLedgerParseError(`${field} is not a list`);
  const out: FanficLedgerFact[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new FanficLedgerParseError(`a ${field} item is not an object`);
    const subject = text(item.subject ?? item.who ?? item.between);
    const detail = text(item.detail ?? item.knows ?? item.state ?? item.stage);
    if (subject && detail) out.push({ subject, detail });
  }
  return out.slice(0, limit);
}

function threads(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new FanficLedgerParseError("openThreads is not a list");
  return value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, LIST_LIMITS.openThreads);
}

export type FanficLedgerDraft = Omit<FanficLedgerEntry, "messageId" | "textKey">;

/** Exactly one entry per expected chapter, in order, each with a summary; anything else is a bad reply. */
export function parseFanficLedgerReply(raw: string, expected: readonly number[]): FanficLedgerDraft[] {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.entries)) throw new FanficLedgerParseError("no entries list");
  if (parsed.entries.length !== expected.length) {
    throw new FanficLedgerParseError(`expected ${expected.length} entries, got ${parsed.entries.length}`);
  }
  return parsed.entries.map((item: unknown, index: number) => {
    if (!isRecord(item)) throw new FanficLedgerParseError("an entry is not an object");
    const chapter = expected[index]!;
    const summary = text(item.summary, SUMMARY_CHARS);
    if (!summary) throw new FanficLedgerParseError(`chapter ${chapter} has no summary`);
    return {
      chapter,
      summary,
      timeline: text(item.timeline),
      knowledge: facts(item.knowledge, LIST_LIMITS.knowledge, "knowledge"),
      conditions: facts(item.conditions, LIST_LIMITS.conditions, "conditions"),
      relationships: facts(item.relationships, LIST_LIMITS.relationships, "relationships"),
      openThreads: threads(item.openThreads),
    };
  });
}

// ── Saving ──────────────────────────────────────

/**
 * Writes entries for `from`..: as a compare-and-set on `metadata.fanficLedger`. Returns false when another writer
 * changed the ledger first, so the caller re-reads instead of overwriting newer work.
 */
async function saveEntries(
  storage: StorageGateway,
  chatId: string,
  expectedRaw: unknown,
  entries: FanficLedgerEntry[],
): Promise<boolean> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged) throw new Error("This runtime can't save the story ledger safely.");
  const { updated } = await updateChatIfUnchanged.call(
    storage,
    chatId,
    { metadata: { fanficLedger: expectedRaw } },
    { metadata: { fanficLedger: { version: FANFIC_LEDGER_VERSION, entries } satisfies FanficLedger } },
  );
  return updated;
}

// ── Updating ────────────────────────────────────

export interface FanficLedgerProgress {
  /** Chapters brought up to date so far in this update. */
  done: number;
  /** Chapters this update has to read. */
  total: number;
}

/** Instructions, the request, and the previous entry, in tokens. */
const LEDGER_OVERHEAD_TOKENS = 3000;

function ledgerBudget(connection: JsonRecord): FanficCallBudget {
  return fanficCallBudget(effectiveMaxContext(connection, {}), {
    maxReplyTokens: LEDGER_MAX_TOKENS,
    overheadTokens: LEDGER_OVERHEAD_TOKENS,
    defaultChars: DEFAULT_CHARS_PER_CALL,
    maxChars: DEFAULT_CHARS_PER_CALL,
  });
}

/** Splits the chapters to read into calls: at most MAX_CHAPTERS_PER_CALL, and within the prose budget. */
export function planFanficLedgerCalls(
  chapters: readonly FanficChapterRef[],
  budgetChars: number,
): FanficChapterRef[][] {
  const calls: FanficChapterRef[][] = [];
  let current: FanficChapterRef[] = [];
  let chars = 0;
  for (const chapter of chapters) {
    const size = chapter.content.length;
    if (current.length > 0 && (current.length >= MAX_CHAPTERS_PER_CALL || chars + size > budgetChars)) {
      calls.push(current);
      current = [];
      chars = 0;
    }
    current.push(chapter);
    chars += size;
  }
  if (current.length > 0) calls.push(current);
  return calls;
}

export interface UpdateFanficLedgerInput {
  chatId: string;
  /** Defaults to the fic's own connection. */
  connectionId?: string | null;
  /** Skip the update unless the ledger is in use (see fanficLedgerInUse): for the quiet update after each chapter. */
  onlyIfInUse?: boolean;
}

/** Share of the writer's window the chapters can fill before old chapters start dropping out of the prompt. */
const LEDGER_WINDOW_SHARE = 0.5;

/**
 * Whether to keep the ledger current after each chapter: once it exists (built by hand or by a continuity check), or
 * once the chapters fill enough of the connection's window that the oldest will soon be left out of the prompt.
 */
function fanficLedgerInUse(
  ledger: FanficLedger,
  chapters: readonly FanficChapterRef[],
  connection: JsonRecord,
): boolean {
  if (ledger.entries.length > 0) return true;
  const window = effectiveMaxContext(connection, {});
  if (window <= 0) return false;
  const chars = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  // About 4 characters a token.
  return chars / 4 > window * LEDGER_WINDOW_SHARE;
}

/**
 * Brings the ledger up to date with the chapters as they read now (each chapter's chosen version), reading only the
 * chapters whose entries are stale. Each call's entries are saved as they arrive, so a stopped update keeps its
 * progress. Returns the ledger, current through the last chapter.
 */
export async function updateFanficLedger(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: UpdateFanficLedgerInput,
  options: { signal?: AbortSignal; onProgress?: (progress: FanficLedgerProgress) => void } = {},
): Promise<FanficLedger> {
  const { signal, onProgress } = options;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const chat = await deps.storage.get("chats", input.chatId);
    if (!isRecord(chat)) throw new Error("Chat was not found.");
    if (readString(chat.mode) !== "fanfic") throw new Error("The story ledger is only kept for fanfic chats.");
    const state = readFanficState(parseRecord(chat.metadata));
    if (!state) throw new Error("Fill in the fanfic request first.");
    const messages = await deps.storage.listChatMessages<JsonRecord>(input.chatId);
    const chapters = fanficChapterRefs(messages.filter(isRecord));
    let expectedRaw = rawLedger(chat.metadata);
    const saved = readFanficLedger(chat.metadata);
    const status = fanficLedgerStatus(saved, chapters);
    const ledger: FanficLedger = { version: FANFIC_LEDGER_VERSION, entries: status.fresh };
    if (status.stale.length === 0) {
      if (saved.entries.length === chapters.length) return ledger;
      // Entries past the last chapter (a deleted chapter): trim them.
      if (await saveEntries(deps.storage, input.chatId, expectedRaw, ledger.entries)) return ledger;
      continue;
    }

    const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
    if (!connectionId || connectionId === "random") {
      if (input.onlyIfInUse) return ledger;
      throw new Error("Pick a connection for the story ledger.");
    }
    const connection = await deps.storage.get("connections", connectionId);
    if (!isRecord(connection)) throw new Error("The ledger connection was not found.");
    if (input.onlyIfInUse && !fanficLedgerInUse(saved, chapters, connection)) return ledger;

    const toRead = chapters.slice(status.fresh.length);
    // A chapter longer than the budget still goes in a call of its own; there's no smaller unit to send.
    const budget = ledgerBudget(connection);
    const calls = planFanficLedgerCalls(toRead, budget.proseChars);
    let done = 0;
    let conflicted = false;
    onProgress?.({ done, total: toRead.length });
    for (const call of calls) {
      const drafts = await completeFanficJson(
        deps.llm,
        {
          connectionId,
          messages: buildFanficLedgerMessages({
            request: state.request,
            previous: ledger.entries[ledger.entries.length - 1] ?? null,
            chapters: call,
          }),
          maxTokens: budget.replyTokens,
        },
        (raw) =>
          parseFanficLedgerReply(
            raw,
            call.map((chapter) => chapter.number),
          ),
        signal,
      );
      const entries = drafts.map((draft, index) => ({
        ...draft,
        messageId: call[index]!.messageId,
        textKey: fanficChapterTextKey(call[index]!.content),
      }));
      const next = [...ledger.entries, ...entries];
      if (!(await saveEntries(deps.storage, input.chatId, expectedRaw, next))) {
        conflicted = true;
        break;
      }
      expectedRaw = { version: FANFIC_LEDGER_VERSION, entries: next };
      ledger.entries = next;
      done += call.length;
      onProgress?.({ done, total: toRead.length });
    }
    if (!conflicted) return ledger;
    // Another tab saved ledger entries first: start over from what it saved.
  }
  throw new Error("The story ledger kept changing while updating. Try again.");
}

// ── In the chapter prompt ───────────────────────

/**
 * The ledger as a prompt section: where things stand after the last chapter it covers, then a line per chapter. Only
 * entries that still match their chapter's text are used. The fitter keeps this section ahead of old chapter prose, so
 * when the window runs short the oldest chapters drop and their summaries stay.
 */
export function renderFanficLedgerForPrompt(ledger: FanficLedger, chapters: readonly FanficChapterRef[]): string {
  const { fresh } = fanficLedgerStatus(ledger, chapters);
  const latest = fresh[fresh.length - 1];
  if (!latest) return "";
  const behind = chapters.length > fresh.length;
  return [
    "## Story ledger",
    `Facts kept chapter by chapter so the story stays consistent. Treat them as facts to respect, not details to mention.${behind ? ` The ledger runs through chapter ${latest.chapter}; where a later chapter says otherwise, the chapter wins.` : ""}`,
    `### Where things stand after chapter ${latest.chapter}\n${renderFanficLedgerState(latest)}`,
    `### Chapter by chapter\n${fresh.map((entry) => `Chapter ${entry.chapter}: ${entry.summary}`).join("\n")}`,
  ].join("\n\n");
}
