// ──────────────────────────────────────────────
// Trance mode: writing and reading the session script
// ──────────────────────────────────────────────
import type { LlmGateway } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { TranceEnding, TranceLine, TrancePhase, TranceScript, TranceState } from "../../contracts/types/trance";
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import { activeCharacterIds } from "../../generation/active-characters";
import { loadCharacters } from "../../generation/prompt-assembly";
import { isRecord, parseRecord, readString } from "../../generation/runtime-records";
import { untilAborted } from "../../shared/until-aborted";
import { userFacingError } from "../../shared/user-facing-error";
import {
  buildTranceScriptMessages,
  pickTranceShape,
  tranceSessionExcerpt,
  tranceTooShortNote,
  type TranceCharacterCard,
} from "./prompts";
import { readTranceState, tranceTargetLines } from "./request";

/** The reply couldn't be read as a session; the message says what was wrong. */
export class TranceScriptParseError extends Error {
  readonly raw: string;
  /** Worded for the person: the screen shows what was wrong instead of a generic failure. */
  readonly code = "user_facing" as const;

  constructor(problem: string, raw: string) {
    super(`The session couldn't be read (${problem}). Try again, or pick a different connection.`);
    this.name = "TranceScriptParseError";
    this.raw = raw;
  }
}

/** Fewer main lines than this share of the target counts as far too short: worth one retry. */
const TOO_SHORT_SHARE = 0.6;
/** Lines longer than this are split at sentence ends so each screen stays one easy read. */
const LONG_LINE = 140;
/** A wake ending needs room for a count up. */
const MIN_WAKE_LINES = 5;
const MIN_EXIT_LINES = 3;
const MIN_SECTION_LINES = 2;
const TOKENS_PER_LINE = 28;
const REPLY_TOKEN_FLOOR = 2500;
const REPLY_TOKEN_CAP = 16000;

type SectionKey = TrancePhase | "exit-gentle" | "exit-calm";

const HEADING = /^\s*#{1,6}\s*(.+?)\s*:?\s*$/;

function sectionKey(title: string): SectionKey | null {
  const normalized = title.toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (/^exit\s*[:\-–—]?\s*gentle/.test(normalized)) return "exit-gentle";
  if (/^exit\s*[:\-–—]?\s*calm/.test(normalized)) return "exit-calm";
  if (/^pre-?talk/.test(normalized)) return "pretalk";
  if (/^induction/.test(normalized)) return "induction";
  if (/^deepen/.test(normalized)) return "deepener";
  if (/^suggestion/.test(normalized)) return "suggestions";
  if (/^wake/.test(normalized)) return "wake";
  if (/^sleep/.test(normalized)) return "sleep";
  return null;
}

/** Drops list markers, numbering and wrapping quotes a model adds despite the format. */
function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "")
    .replace(/^["“](.*)["”]$/, "$1")
    .trim();
}

/** Splits a long line at sentence ends; a long single sentence stays whole. */
export function splitTranceLine(text: string): string[] {
  if (text.length <= LONG_LINE) return [text];
  const sentences =
    text
      .match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)\s*/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? [];
  if (sentences.length <= 1) return [text];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (current && joined.length > LONG_LINE) {
      out.push(current);
      current = sentence;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

export interface ParsedTranceReply {
  lines: TranceLine[];
  exits: TranceScript["exits"];
}

const MAIN_ORDER: TrancePhase[] = ["pretalk", "induction", "deepener", "suggestions"];

/** Reads the model's sectioned reply into lines; throws when a required section is missing or empty. */
export function parseTranceReply(raw: string, ending: TranceEnding): ParsedTranceReply {
  const text = extractLeadingThinkingBlocks(raw).cleanText;
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const heading = rawLine.match(HEADING);
    if (heading) {
      current = sectionKey(heading[1] ?? "");
      if (current && !sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue;
    const line = cleanLine(rawLine);
    if (line) sections.get(current)!.push(...splitTranceLine(line));
  }

  const count = (key: SectionKey) => sections.get(key)?.length ?? 0;
  for (const key of ["induction", "deepener", "suggestions"] as const) {
    if (count(key) < MIN_SECTION_LINES) throw new TranceScriptParseError(`no ${key} section`, raw);
  }
  const wrongEnding: TrancePhase = ending === "wake" ? "sleep" : "wake";
  if (count(ending) === 0) {
    throw new TranceScriptParseError(
      count(wrongEnding) > 0 ? `it ended with ${wrongEnding} instead of ${ending}` : `no ${ending} ending`,
      raw,
    );
  }
  if (ending === "wake" && count("wake") < MIN_WAKE_LINES)
    throw new TranceScriptParseError("the wake-up is too short", raw);
  if (count("exit-gentle") < MIN_EXIT_LINES) throw new TranceScriptParseError("no gentle exit", raw);
  if (count("exit-calm") < MIN_EXIT_LINES) throw new TranceScriptParseError("no calm exit", raw);

  const lines: TranceLine[] = [...MAIN_ORDER, ending].flatMap((phase) =>
    (sections.get(phase) ?? []).map((line) => ({ phase, text: line })),
  );
  return { lines, exits: { gentle: sections.get("exit-gentle")!, calm: sections.get("exit-calm")! } };
}

function tranceReplyTokens(targetLines: number): number {
  return Math.min(REPLY_TOKEN_CAP, Math.max(REPLY_TOKEN_FLOOR, Math.round((targetLines + 30) * TOKENS_PER_LINE)));
}

function cardFromContext(character: {
  name: string;
  description: string;
  personality?: string;
  scenario?: string;
  mesExample?: string;
}): TranceCharacterCard {
  return {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    mesExample: character.mesExample,
  };
}

/** How many earlier scripts with the same guide the writer sees, so a new one doesn't repeat them. */
const EARLIER_SESSIONS = 3;

/**
 * Excerpts of the latest scripts this guide wrote: this session's own script first when it's being rewritten,
 * then other trance sessions with the same character, newest first.
 */
async function earlierTranceExcerpts(
  storage: StorageGateway,
  chatId: string,
  characterId: string,
  current: TranceScript | null,
): Promise<string[][]> {
  const others: TranceScript[] = [];
  for (const row of await storage.list<unknown>("chats")) {
    if (!isRecord(row) || readString(row.id) === chatId || readString(row.mode) !== "trance") continue;
    if (!activeCharacterIds(row).includes(characterId)) continue;
    const script = readTranceState(parseRecord(row.metadata))?.script;
    if (script && script.lines.length > 0) others.push(script);
  }
  others.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...(current ? [current] : []), ...others]
    .slice(0, EARLIER_SESSIONS)
    .map((script) => tranceSessionExcerpt(script.lines));
}

const TRANCE_NO_CONNECTION ="Pick a model connection for this session first.";
const TRANCE_NO_CHARACTER = "Pick a character to guide this session first.";

export interface GenerateTranceScriptOptions {
  signal?: AbortSignal;
  now?: () => Date;
  /** Picks the way in, deepener and thread; Math.random by default. */
  random?: () => number;
}

/**
 * Writes the session from the stored request in the chat character's voice and stores it on `metadata.trance`.
 * A reply far shorter than asked gets one retry; a second short reply is kept, and its real length is what the
 * session shows. A reply that breaks the format gets one retry too, then fails with what was wrong.
 */
export async function generateTranceScript(
  deps: { storage: StorageGateway; llm: LlmGateway },
  chatId: string,
  options: GenerateTranceScriptOptions = {},
): Promise<TranceState> {
  const { signal } = options;
  const chat = await deps.storage.get("chats", chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "trance") throw new Error("Scripts are only written for trance sessions.");
  const state = readTranceState(parseRecord(chat.metadata));
  if (!state) throw userFacingError("Fill in the session first.");
  const connectionId = readString(chat.connectionId).trim();
  if (!connectionId) throw userFacingError(TRANCE_NO_CONNECTION);
  const [character] = await loadCharacters(deps.storage, chat);
  if (!character) throw userFacingError(TRANCE_NO_CHARACTER);

  const card = cardFromContext(character);
  const target = tranceTargetLines(state.request.minutes);
  const maxTokens = tranceReplyTokens(target);
  // One way in, deepener and thread per script, kept across retries.
  const shape = pickTranceShape(options.random);
  const earlier = await earlierTranceExcerpts(deps.storage, chatId, character.id, state.script);
  const call = (retry?: { previous: string; note: string }) =>
    untilAborted(
      deps.llm.complete(
        {
          connectionId,
          messages: buildTranceScriptMessages(state.request, card, shape, earlier, retry),
          parameters: { maxTokens, temperature: 1 },
        },
        signal,
      ),
      signal,
    );

  let raw = await call();
  let parsed: ParsedTranceReply;
  try {
    parsed = parseTranceReply(raw, state.request.ending);
  } catch (error) {
    if (!(error instanceof TranceScriptParseError)) throw error;
    raw = await call();
    parsed = parseTranceReply(raw, state.request.ending);
  }
  if (parsed.lines.length < target * TOO_SHORT_SHARE) {
    const retryRaw = await call({ previous: raw, note: tranceTooShortNote(parsed.lines.length, target) });
    try {
      const longer = parseTranceReply(retryRaw, state.request.ending);
      if (longer.lines.length > parsed.lines.length) parsed = longer;
    } catch (error) {
      if (!(error instanceof TranceScriptParseError)) throw error;
    }
  }
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  const script: TranceScript = {
    lines: parsed.lines,
    exits: parsed.exits,
    connectionId,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  const next: TranceState = { ...state, script };
  await deps.storage.patchChatMetadata(chatId, { trance: next });
  return next;
}
