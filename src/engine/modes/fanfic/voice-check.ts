// ──────────────────────────────────────────────
// Fanfic voice check: lines a character wouldn't say, measured against their voice sheet
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficRequest, FanficVoiceSheet } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import { locateFanficPassage, type FanficContinuityFix } from "./continuity";
import { fanficChapterTextKey } from "./ledger";
import { effectiveMaxContext } from "../../generation/context-window";
import {
  completeFanficJson,
  fanficCallBudget,
  fanficMessageChars,
  FanficReplyParseError,
  parseFanficJsonReply,
} from "./llm-json";
import { renderFanficRequestForPrompt, renderFanficVoiceSheets } from "./prompts";
import { fanficSamePassage, fanficSearchableText } from "./quality";
import { readFanficState } from "./request";

const CHECK_MAX_TOKENS = 6000;
const VERIFY_MAX_TOKENS = 4000;
const MAX_ISSUES = 8;
/** The end of the chapter before, so a line reacting to it reads in context. */
const PREVIOUS_TAIL_CHARS = 3000;

export class FanficVoiceCheckParseError extends FanficReplyParseError {
  constructor(detail: string) {
    super(`The voice check reply could not be read (${detail}).`);
    this.name = "FanficVoiceCheckParseError";
  }
}

/** What part of the sheet a line breaks. */
export const FANFIC_VOICE_BREAKS = ["wording", "register", "motive"] as const;
export type FanficVoiceBreak = (typeof FANFIC_VOICE_BREAKS)[number];

export const FANFIC_VOICE_BREAK_LABELS: Record<FanficVoiceBreak, string> = {
  wording: "Words they wouldn't use",
  register: "Doesn't sound like them",
  motive: "Not why they'd do it",
};

export interface FanficVoiceIssue {
  character: string;
  kind: FanficVoiceBreak;
  /** The line, copied from the chapter. */
  quote: string;
  /** What the sheet says that the line breaks. */
  sheetPoint: string;
  explanation: string;
  fix: FanficContinuityFix | null;
}

export interface FanficChapterVoiceCheck {
  chapter: number;
  messageId: string;
  /** Fingerprint of the chapter text that was checked; fixes only apply to that text. */
  textKey: string;
  issues: FanficVoiceIssue[];
  candidates: number;
  ungrounded: number;
  rejected: number;
  merged: number;
}

export type FanficVoiceCheckPhase = "checking" | "verifying";

function requestBlock(request: FanficRequest): string {
  return renderFanficRequestForPrompt({ ...request, styleNotes: "" });
}

function storyBlock(target: FanficChapterRef, previous: FanficChapterRef | null): string {
  const parts: string[] = [];
  if (previous) {
    const tail = previous.content.trim().slice(-PREVIOUS_TAIL_CHARS);
    parts.push(`## End of chapter ${previous.number} (context only)\n\n…${tail}`);
  }
  parts.push(`## Chapter ${target.number} (the chapter to check)\n\n${target.content.trim()}`);
  return parts.join("\n\n");
}

export function buildFanficVoiceCheckMessages(args: {
  request: FanficRequest;
  voices: readonly FanficVoiceSheet[];
  target: FanficChapterRef;
  previous: FanficChapterRef | null;
}): LlmMessage[] {
  const n = args.target.number;
  const names = args.voices.map((sheet) => sheet.name);
  const system = [
    `You are a fandom beta reader checking chapter ${n} of a fic for lines that are out of character: things ${names.join(", ")} would not say, or would not say this way, given their voice sheets below.`,
    "## What counts",
    "- wording: a word, phrase, or pet name the sheet says they'd never use, or modern/therapy-speak/generic phrasing their voice doesn't have.",
    "- register: the line is in the wrong voice for them (too polished, too gushing, too soft, too modern, a speech instead of how they actually talk), even if the words are fine.",
    "- motive: they say or do something for a reason that goes against what drives them on their sheet, with nothing in the story to explain the change.",
    "## What does not count",
    "- Change the story has built toward or explains (growth over chapters, a lie, a mask, sarcasm, a joke).",
    "- Changes the request asked for (alternate universe, a softer or darker take named in the prompt or tags).",
    "- The reader insert or original characters, and narration that isn't a character's voice.",
    "- Style complaints about the prose in general.",
    "## Reply format",
    'Reply with JSON only: {"issues": [{"character": string, "kind": "wording" | "register" | "motive", "quote": string, "sheetPoint": string, "explanation": string, "fix": {"find": string, "replace": string} | null}]}',
    `- character is one of: ${names.join(", ")}.`,
    `- quote is the line from chapter ${n}, copied character for character, 5 to 40 words. Never paraphrase.`,
    "- sheetPoint quotes or closely names the part of their sheet the line breaks. explanation is one sentence on why it's out of character.",
    `- fix is the smallest change that puts the line back in their voice: find is copied character for character from chapter ${n}, and replace is how they'd actually say it, keeping what the line does for the scene. Use null when it would take more than a couple of sentences.`,
    `- List at most ${MAX_ISSUES} issues, the clearest first. A chapter with none is common: reply {"issues": []}.`,
    renderFanficVoiceSheets(args.voices),
    `## The request\n${requestBlock(args.request)}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${storyBlock(args.target, args.previous)}\n\nList the out-of-character lines in chapter ${n} now.`,
    },
  ];
}

function buildFanficVoiceVerifyMessages(args: {
  request: FanficRequest;
  voices: readonly FanficVoiceSheet[];
  target: FanficChapterRef;
  previous: FanficChapterRef | null;
  issues: FanficVoiceIssue[];
}): LlmMessage[] {
  const notes = args.issues
    .map(
      (issue, index) =>
        `${index + 1}. ${issue.character}: "${issue.quote}". Sheet: ${issue.sheetPoint}. Claimed: ${issue.explanation}`,
    )
    .join("\n");
  const system = [
    `You double-check a beta reader's out-of-character notes on chapter ${args.target.number}. For each numbered note, reread the line in context and the character's voice sheet, and decide whether the line is really out of character.`,
    "A note holds only when a fan of the character would wince at the line. It does not hold when the story sets the line up (sarcasm, a lie, a joke, growth it has built toward), when the request asked for this take on them, when the line belongs to someone else, or when the note misreads it.",
    'Reply with JSON only: {"verdicts": [{"note": number, "reason": string, "outOfCharacter": boolean, "sameAs": number | null}]}, exactly one entry per note. Write reason first: one sentence on what the line is doing in the scene. Then decide.',
    "When a note repeats an earlier note's problem with the same line, set sameAs to that earlier note's number; otherwise sameAs is null.",
    renderFanficVoiceSheets(args.voices),
    `## The notes\n${notes}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${storyBlock(args.target, args.previous)}\n\nCheck every note now.` },
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

function stripQuotes(text: string): string {
  return text
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

export function parseFanficVoiceCheckReply(raw: string, names: readonly string[]): FanficVoiceIssue[] {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.issues)) throw new FanficVoiceCheckParseError("no issues list");
  return parsed.issues.map((item) => {
    if (!isRecord(item)) throw new FanficVoiceCheckParseError("an issue is not an object");
    const quote = stripQuotes(readString(item.quote));
    const explanation = readString(item.explanation).trim();
    if (!quote || !explanation) throw new FanficVoiceCheckParseError("an issue has no quote or explanation");
    const said = readString(item.character).trim().toLowerCase();
    const character = names.find((name) => name.toLowerCase() === said) ?? readString(item.character).trim();
    const kind = FANFIC_VOICE_BREAKS.find((value) => value === readString(item.kind).trim()) ?? "register";
    return {
      character,
      kind,
      quote: quote.slice(0, 600),
      sheetPoint: readString(item.sheetPoint).trim().slice(0, 400),
      explanation: explanation.slice(0, 600),
      fix: readFix(item.fix),
    };
  });
}

/** One boolean verdict per note, plus repeats folded into the note they repeat. */
export function parseFanficVoiceVerdicts(
  raw: string,
  noteCount: number,
): { confirmed: Set<number>; sameAs: Map<number, number> } {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.verdicts)) throw new FanficVoiceCheckParseError("no verdicts list");
  const confirmed = new Set<number>();
  const sameAs = new Map<number, number>();
  const ruled = new Set<number>();
  for (const verdict of parsed.verdicts) {
    if (!isRecord(verdict) || typeof verdict.outOfCharacter !== "boolean") {
      throw new FanficVoiceCheckParseError("a verdict has no ruling");
    }
    const note = Number(verdict.note);
    if (!Number.isInteger(note) || note < 1 || note > noteCount || ruled.has(note)) {
      throw new FanficVoiceCheckParseError("a verdict names no note, or one twice");
    }
    ruled.add(note);
    if (verdict.outOfCharacter) confirmed.add(note);
    const earlier = Number(verdict.sameAs);
    if (Number.isInteger(earlier) && earlier >= 1 && earlier < note) sameAs.set(note, earlier);
  }
  if (ruled.size !== noteCount) throw new FanficVoiceCheckParseError("not every note was ruled on");
  return { confirmed, sameAs };
}

/**
 * Keeps notes whose line is really in the chapter and belongs to a character with a sheet; drops exact repeats (same
 * character and line) and fixes that can't be placed exactly once.
 */
export function groundFanficVoiceIssues(
  issues: FanficVoiceIssue[],
  chapterText: string,
  names: readonly string[],
): { grounded: FanficVoiceIssue[]; dropped: number; repeats: number } {
  const grounded: FanficVoiceIssue[] = [];
  let dropped = 0;
  let repeats = 0;
  // Padded so a quote only matches whole words.
  const text = ` ${fanficSearchableText(chapterText)} `;
  const known = new Set(names.map((name) => name.toLowerCase()));
  for (const issue of issues) {
    const needle = fanficSearchableText(issue.quote);
    if (needle.split(" ").length < 3 || !text.includes(` ${needle} `) || !known.has(issue.character.toLowerCase())) {
      dropped += 1;
      continue;
    }
    const placed = { ...issue, fix: issue.fix && locateFanficPassage(chapterText, issue.fix.find) ? issue.fix : null };
    const kept = grounded.find(
      (entry) => entry.character === placed.character && fanficSamePassage(entry.quote, placed.quote),
    );
    if (kept) {
      repeats += 1;
      kept.fix ??= placed.fix;
    } else grounded.push(placed);
  }
  return { grounded, dropped, repeats };
}

// ── Running ─────────────────────────────────────

export interface CheckFanficChapterVoiceInput {
  chatId: string;
  messageId: string;
  connectionId?: string | null;
}

/**
 * Checks one chapter's lines against the fic's voice sheets: one read lists out-of-character lines with the sheet
 * point each breaks, quotes are checked against the chapter, then a second read must rule on every note.
 */
export async function checkFanficChapterVoice(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: CheckFanficChapterVoiceInput,
  options: { signal?: AbortSignal; onPhase?: (phase: FanficVoiceCheckPhase) => void } = {},
): Promise<FanficChapterVoiceCheck> {
  const { signal, onPhase } = options;
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Voice checks only run for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw new Error("Fill in the fanfic request first.");
  const voices = state.voices ?? [];
  if (voices.length === 0) throw new Error("Build the voice sheets first (Voices, at the top of the fic).");
  const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
  if (!connectionId || connectionId === "random") throw new Error("Pick a connection for the voice check.");
  const connection = await deps.storage.get("connections", connectionId);
  if (!isRecord(connection)) throw new Error("The connection was not found.");

  const messages = await deps.storage.listChatMessages<JsonRecord>(input.chatId);
  const chapters = fanficChapterRefs(messages.filter(isRecord));
  const target = chapters.find((chapter) => chapter.messageId === input.messageId);
  if (!target) throw new Error("That chapter is no longer in this fic.");
  const previous = chapters[target.number - 2] ?? null;
  const names = voices.map((sheet) => sheet.name);
  // Everything goes in whole (sheets, chapter, the end of the one before), so only the reply is sized; the
  // double-check adds its notes.
  const frame = buildFanficVoiceCheckMessages({ request: state.request, voices, target, previous });
  const budget = fanficCallBudget(effectiveMaxContext(connection, {}), {
    maxReplyTokens: CHECK_MAX_TOKENS,
    fixedChars: fanficMessageChars(frame) + MAX_ISSUES * 700,
    defaultChars: 0,
    what: `checking chapter ${target.number}'s voices`,
  });

  onPhase?.("checking");
  const candidates = await completeFanficJson(
    deps.llm,
    {
      connectionId,
      messages: buildFanficVoiceCheckMessages({ request: state.request, voices, target, previous }),
      maxTokens: budget.replyTokens,
    },
    (raw) => parseFanficVoiceCheckReply(raw, names),
    signal,
  );
  const { grounded, dropped, repeats } = groundFanficVoiceIssues(candidates, target.content, names);
  const confirmed: FanficVoiceIssue[] = [];
  let merged = 0;
  if (grounded.length > 0) {
    onPhase?.("verifying");
    const verdicts = await completeFanficJson(
      deps.llm,
      {
        connectionId,
        messages: buildFanficVoiceVerifyMessages({
          request: state.request,
          voices,
          target,
          previous,
          issues: grounded,
        }),
        maxTokens: Math.min(VERIFY_MAX_TOKENS, budget.replyTokens),
      },
      (raw) => parseFanficVoiceVerdicts(raw, grounded.length),
      signal,
    );
    grounded.forEach((issue, index) => {
      const note = index + 1;
      if (!verdicts.confirmed.has(note)) return;
      const earlier = verdicts.sameAs.get(note);
      const kept = earlier !== undefined && verdicts.confirmed.has(earlier) ? grounded[earlier - 1] : undefined;
      if (kept) {
        merged += 1;
        kept.fix ??= issue.fix;
        return;
      }
      confirmed.push(issue);
    });
  }
  return {
    chapter: target.number,
    messageId: target.messageId,
    textKey: fanficChapterTextKey(target.content),
    issues: confirmed,
    candidates: candidates.length,
    ungrounded: dropped,
    rejected: grounded.length - confirmed.length - merged,
    merged: merged + repeats,
  };
}
