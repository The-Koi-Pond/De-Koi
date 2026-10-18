// ──────────────────────────────────────────────
// Fanfic passage rewrites: change one stretch of a chapter, leave the rest as written
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { effectiveMaxContext } from "../../generation/context-window";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { fanficChapterRefs, type FanficChapterRef } from "./chapter-refs";
import { fanficChapterTextKey, fanficLedgerStatus, readFanficLedger, renderFanficLedgerState } from "./ledger";
import {
  cleanFanficReply,
  fanficCallBudget,
  fanficMessageChars,
  FanficWindowTooSmallError,
  untilAborted,
} from "./llm-json";
import {
  FANFIC_PROSE_RULES,
  fanficContentRules,
  renderFanficRequestForPrompt,
  renderFanficVoiceSheets,
  stripFanficChapterHeading,
} from "./prompts";
import { readFanficState } from "./request";

/** The chapter around the passage, sent whole when it fits: the rewrite must keep every fact it sets up. */
const BEFORE_CHARS = 30_000;
const AFTER_CHARS = 12_000;
const MAX_PASSAGE_CHARS = 16_000;
const REWRITE_MAX_TOKENS = 8000;

export interface FanficPassageSpan {
  start: number;
  end: number;
}

export function buildFanficPassageRewriteMessages(args: {
  state: FanficState;
  chapterNumber: number;
  /** Where things stand going into this chapter, from the story ledger. */
  ledgerState: string;
  /** The story's facts as of the end of this chapter as first written, and what later chapters do with them. */
  ledgerAfter?: string;
  before: string;
  passage: string;
  after: string;
  instruction: string;
}): LlmMessage[] {
  const { request } = args.state;
  const system = [
    `You revise one passage of chapter ${args.chapterNumber} of a requested ${request.fandom ? `${request.fandom} ` : ""}fanfic. The rest of the chapter stays exactly as written, so the new passage has to join the text before and after it without a seam: same point of view, tense, names, and what each character knows at that moment.`,
    ...FANFIC_PROSE_RULES,
    `## Content rules\n${fanficContentRules(request)}`,
    `## The request\n${renderFanficRequestForPrompt(request)}`,
    renderFanficVoiceSheets(args.state.voices),
    args.ledgerState.trim()
      ? `## Where things stand going into chapter ${args.chapterNumber}\n${args.ledgerState.trim()}`
      : "",
    args.ledgerAfter?.trim()
      ? `## Facts that must still hold\nAs of the end of this chapter, and what the chapters after it build on. The rewrite can't contradict these.\n${args.ledgerAfter.trim()}`
      : "",
    "## Keep the story straight\nKeep every fact the rest of the chapter and the story set up: injuries and bandages, clothing, objects, who knows what, what is scheduled or cancelled, the time of day. A new complication must fit those facts and not start anything later chapters would contradict or have to follow up: let it play out inside the passage, or keep it small enough that the story as written still works.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const user = [
    args.before.trim() ? `## The chapter before the passage\n…${args.before}` : "## The passage opens the chapter.",
    `## The passage to rewrite\n${args.passage}`,
    args.after.trim() ? `## The chapter after the passage\n${args.after}…` : "## The passage ends the chapter.",
    `## What to change\n${args.instruction.trim()}`,
    "Rewrite only the passage. Keep what it has to do for the story unless the change says otherwise, keep about the same length unless the change needs more or less room, and make its first and last lines meet the text around it. Output only the new passage: no heading, no notes, no quotation marks around it.",
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The model's passage without the wrappers models sometimes add (code fences, a heading, surrounding quotes). */
export function cleanFanficPassageReply(raw: string): string {
  let text = cleanFanficReply(raw).trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^#{1,6}\s*(?:the )?(?:new |rewritten )?passage[^\n]*\n+/i, "");
  if (/^"""[\s\S]*"""$/.test(text)) text = text.slice(3, -3).trim();
  return text;
}

export interface FanficChapterForEdit {
  state: FanficState;
  chapter: FanficChapterRef;
  /** The message's raw content (heading kept, if it has one); spans index into this. */
  raw: string;
  /** Where the stripped chapter text starts inside `raw`. */
  offset: number;
  ledgerState: string;
  ledgerAfter: string;
  connectionId: string;
  window: number;
}

/** Loads a chapter for editing and checks it is still the text the caller looked at. */
export async function loadFanficChapterForEdit(
  storage: StorageGateway,
  input: { chatId: string; messageId: string; textKey: string; connectionId?: string | null },
): Promise<FanficChapterForEdit> {
  const chat = await storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Passage edits are only for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw new Error("Fill in the fanfic request first.");
  const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
  if (!connectionId || connectionId === "random") throw new Error("Pick a connection for this fic first.");
  const connection = await storage.get("connections", connectionId);
  if (!isRecord(connection)) throw new Error("The connection was not found.");
  const messages = (await storage.listChatMessages<JsonRecord>(input.chatId)).filter(isRecord);
  const message = messages.find((entry) => readString(entry.id) === input.messageId);
  const chapter = fanficChapterRefs(messages).find((entry) => entry.messageId === input.messageId);
  if (!message || !chapter) throw new Error("That chapter is no longer in this fic.");
  if (fanficChapterTextKey(chapter.content) !== input.textKey) {
    throw new Error("The chapter changed since then. Look at it again before rewriting.");
  }
  const raw = readString(message.content);
  const fresh = fanficLedgerStatus(readFanficLedger(chat.metadata), fanficChapterRefs(messages)).fresh;
  const before = fresh[chapter.number - 2];
  const current = fresh[chapter.number - 1];
  const later = fresh.slice(chapter.number).map((entry) => `Chapter ${entry.chapter}: ${entry.summary}`);
  return {
    state,
    chapter,
    raw,
    offset: raw.length - stripFanficChapterHeading(raw).length,
    ledgerState: before ? renderFanficLedgerState(before) : "",
    ledgerAfter: [
      current ? renderFanficLedgerState(current) : "",
      later.length ? `What happens next:\n${later.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    connectionId,
    window: effectiveMaxContext(connection, {}),
  };
}

/**
 * One rewritten passage: the chapter text around it goes along for flow, and only the passage comes back. Spans index
 * into the chapter text without its heading (`chapter.content`).
 */
export async function rewriteFanficPassageText(
  llm: LlmGateway,
  target: FanficChapterForEdit,
  text: string,
  span: FanficPassageSpan,
  instruction: string,
  signal?: AbortSignal,
): Promise<string> {
  const passage = text.slice(span.start, span.end);
  if (!passage.trim()) throw new Error("Pick some text to rewrite.");
  if (passage.length > MAX_PASSAGE_CHARS) throw new Error("That passage is too long to rewrite in one go. Pick less.");
  if (!instruction.trim()) throw new Error("Say what should change.");
  const build = (before: number, after: number) =>
    buildFanficPassageRewriteMessages({
      state: target.state,
      chapterNumber: target.chapter.number,
      ledgerState: target.ledgerState,
      ledgerAfter: target.ledgerAfter,
      before: text.slice(Math.max(0, span.start - before), span.start),
      passage,
      after: text.slice(span.end, span.end + after),
      instruction,
    });
  const budget = fanficCallBudget(target.window, {
    maxReplyTokens: Math.min(REWRITE_MAX_TOKENS, Math.ceil(passage.length / 2) + 1500),
    fixedChars: fanficMessageChars(build(0, 0)),
    defaultChars: BEFORE_CHARS + AFTER_CHARS,
    what: "rewriting this passage",
  });
  // As much of the chapter around the passage as the window allows, most of it from before.
  const room = Math.min(budget.proseChars, BEFORE_CHARS + AFTER_CHARS);
  const messages = build(Math.min(BEFORE_CHARS, Math.round(room * 0.7)), Math.min(AFTER_CHARS, Math.round(room * 0.3)));
  // The reply has to hold the passage at its length or a bit more.
  if (target.window > 0 && budget.replyTokens * 3 < passage.length) {
    throw new FanficWindowTooSmallError("rewriting a passage this long");
  }
  // Settles on Stop even when the gateway can't cancel a request already sent.
  const raw = await untilAborted(
    llm.complete(
      {
        connectionId: target.connectionId,
        messages,
        parameters: { maxTokens: budget.replyTokens, temperature: 0.9 },
      },
      signal,
    ),
    signal,
  );
  const rewritten = cleanFanficPassageReply(raw);
  if (!rewritten) throw new Error("The rewrite came back empty. Try again.");
  return rewritten;
}

/** Splices replacements into the chapter text (spans must not overlap) and saves it as a new version. */
export async function saveFanficPassageEdits(
  storage: StorageGateway,
  input: { chatId: string; target: FanficChapterForEdit; edits: Array<FanficPassageSpan & { text: string }> },
): Promise<{ textKey: string }> {
  const { target } = input;
  const ordered = [...input.edits].sort((a, b) => b.start - a.start);
  let text = target.chapter.content;
  let floor = Infinity;
  for (const edit of ordered) {
    if (edit.end > floor || edit.start < 0 || edit.end > target.chapter.content.length || edit.start >= edit.end) {
      throw new Error("Those passages overlap or fall outside the chapter.");
    }
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
    floor = edit.start;
  }
  const content = `${target.raw.slice(0, target.offset)}${text}`;
  await storage.addChatMessageSwipe(input.chatId, target.chapter.messageId, content, { activate: true });
  return { textKey: fanficChapterTextKey(stripFanficChapterHeading(content)) };
}
