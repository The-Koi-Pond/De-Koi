// ──────────────────────────────────────────────
// Fanfic chapter comments: AO3-style threads under a chapter, answered by the fic's author
// ──────────────────────────────────────────────
// Each thread is a chat of its own. It names the fic as its `ownerChatId`, so it stays out of the chat lists and search
// and is deleted with the fic. It is in fanfic mode, so no persona, prompt preset, agent or memory recall reaches it,
// and its history is only its own comments. The ordinary chat reply pipeline answers it (streaming, Stop, redo with
// versions, the hosted runner); prompt assembly swaps the author's writing prompt for the comment prompt built here,
// read fresh from the fic on every reply.
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficCommentThread, FanficState } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { fanficCanonLine, fanficChapterLayout } from "./chapter-refs";
import { fanficChapterTextKey, readFanficLedger, renderFanficLedgerForPrompt } from "./ledger";
import { cleanFanficReply, FANFIC_NO_CONNECTION, loadFanficConnection, untilAborted } from "./llm-json";
import {
  fanficContentRules,
  renderFanficOutline,
  renderFanficRequestForPrompt,
  renderFanficVoiceSheets,
  stripFanficChapterHeading,
  type FanficPromptSegment,
} from "./prompts";
import { readFanficState } from "./request";
import { readFanficVersion } from "./versions";

export const FANFIC_COMMENT_MAX_CHARS = 4000;

export function readFanficCommentThread(metadata: unknown): FanficCommentThread | null {
  const raw = parseRecord(parseRecord(metadata).fanficComment);
  const ficChatId = readString(raw.ficChatId).trim();
  const chapterMessageId = readString(raw.chapterMessageId).trim();
  if (raw.version !== 1 || !ficChatId || !chapterMessageId) return null;
  return {
    version: 1,
    ficChatId,
    chapterMessageId,
    chapterLabel: readString(raw.chapterLabel).trim(),
    textKey: readString(raw.textKey),
  };
}

/** The fic's own chat, refusing a comment thread (threads don't nest) and anything that isn't a fic. */
async function readFic(storage: StorageGateway, ficChatId: string): Promise<{ chat: JsonRecord; state: FanficState }> {
  const chat = await storage.get<JsonRecord>("chats", ficChatId);
  if (!isRecord(chat) || readString(chat.mode) !== "fanfic" || readString(chat.ownerChatId).trim()) {
    throw userFacingError("That fic is no longer here.");
  }
  const state = readFanficState(chat.metadata);
  if (!state) throw userFacingError("That fic has no request yet.");
  return { chat, state };
}

/**
 * The connection a thread's replies come from: the model that wrote the version of the chapter being commented on,
 * while that connection still exists, else the fic's own connection.
 */
async function threadConnectionId(storage: StorageGateway, fic: JsonRecord, chapter: JsonRecord): Promise<string> {
  const models = readFanficVersion(chapter.extra)?.models ?? [];
  const writer = readString(models[models.length - 1]?.connectionId).trim();
  if (writer && isRecord(await storage.get("connections", writer).catch(() => null))) return writer;
  const own = readString(fic.connectionId).trim();
  if (!own) throw userFacingError("Pick a model connection for this fic first.");
  return own;
}

/**
 * Opens a new comment thread under one chapter: the thread's chat, with no comments yet. The first comment is then
 * sent to it like any chat message, so it is saved and answered by the shared reply pipeline.
 */
export async function createFanficCommentThread(
  storage: StorageGateway,
  input: { ficChatId: string; chapterMessageId: string },
): Promise<JsonRecord> {
  const ficChatId = input.ficChatId.trim();
  const { chat: fic } = await readFic(storage, ficChatId);
  const messages = await storage.listChatMessages<JsonRecord>(ficChatId);
  const chapter = fanficChapterLayout(messages).chapters.find((entry) => entry.messageId === input.chapterMessageId);
  const message = chapter ? messages.find((entry) => entry.id === chapter.messageId) : undefined;
  if (!chapter || !message) throw userFacingError("That chapter is no longer in this fic.");
  const thread: FanficCommentThread = {
    version: 1,
    ficChatId,
    chapterMessageId: chapter.messageId,
    chapterLabel: chapter.label,
    textKey: fanficChapterTextKey(stripFanficChapterHeading(chapter.content)),
  };
  return storage.create<JsonRecord>("chats", {
    name: `Comments on chapter ${chapter.label}`,
    mode: "fanfic",
    ownerChatId: ficChatId,
    characterIds: [],
    groupId: null,
    folderId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: await threadConnectionId(storage, fic, message),
    connectedChatId: null,
    activeLorebookIds: [],
    metadata: { fanficComment: thread },
  });
}

/** A fic's comment threads, oldest first. */
export async function listFanficCommentThreads(storage: StorageGateway, ficChatId: string): Promise<JsonRecord[]> {
  const chats = await storage.list<JsonRecord>("chats", { filters: { ownerChatId: ficChatId } });
  return chats
    .filter((chat) => readFanficCommentThread(chat.metadata)?.ficChatId === ficChatId)
    .sort((a, b) => readString(a.createdAt).localeCompare(readString(b.createdAt)));
}

/** What a comment reply's prompt is built from: the thread and the fic it belongs to, as they are now. */
export interface FanficCommentContext {
  thread: FanficCommentThread;
  state: FanficState;
  ficMetadata: JsonRecord;
  ficMessages: JsonRecord[];
}

/** Null for a chat that is not a comment thread. */
export async function loadFanficCommentContext(
  storage: StorageGateway,
  chatMetadata: unknown,
): Promise<FanficCommentContext | null> {
  const thread = readFanficCommentThread(chatMetadata);
  if (!thread) return null;
  const { chat, state } = await readFic(storage, thread.ficChatId);
  const ficMessages = await storage.listChatMessages<JsonRecord>(thread.ficChatId);
  return { thread, state, ficMetadata: parseRecord(chat.metadata), ficMessages };
}

const AUTHOR_RULES = [
  "You wrote this fanfic for the person you are talking to: they requested it, and they have left a comment on one of its chapters. You answer as the author in the chapter's comments, one comment at a time.",
  "Talk the story through with them like a collaborator. Say what you were going for and why the story went the way it did. Take their reaction seriously, and when they don't like something, offer two or three concrete alternatives, each with what it would change in the chapters after it and how well it fits the outline, the characters and the ending. Say plainly when an idea would break something the story has already set up, and say which option you would pick and why.",
  "Don't just agree with whatever they say, don't flatter them, and don't apologise for the story. If you can't tell what they want, ask.",
  "Keep it to the length of a comment: a few short paragraphs at most, plain text, no headings, no sign-off. Don't write the chapter or long new passages here; a line or two of example is fine.",
  "Nothing said here changes the fic by itself. Don't claim you have rewritten or re-planned anything.",
].join("\n");

function chapterSection(context: FanficCommentContext): string {
  const layout = fanficChapterLayout(context.ficMessages);
  const chapter = layout.chapters.find((entry) => entry.messageId === context.thread.chapterMessageId);
  if (!chapter) {
    return `## The chapter they commented on\nChapter ${context.thread.chapterLabel || "?"} has since been deleted from the fic.`;
  }
  const text = stripFanficChapterHeading(chapter.content);
  const planned = context.state.outline?.chapters.find((entry) => entry.number === chapter.mainNumber);
  const name = chapter.extra
    ? `extra chapter ${chapter.label}, a ${chapter.extra.canon ? "canon" : "side-story"} extra after chapter ${chapter.mainNumber}`
    : `chapter ${chapter.label}${planned ? `: ${planned.title}` : ""}`;
  const rewritten =
    context.thread.textKey && fanficChapterTextKey(text) !== context.thread.textKey
      ? " The chapter has been rewritten since this thread started, so earlier comments may be about a different version."
      : "";
  return `## The chapter they commented on\nThis is ${name} as it reads now.${rewritten}\n\n${text}`;
}

function writtenSection(context: FanficCommentContext): string {
  const layout = fanficChapterLayout(context.ficMessages);
  const planned = context.state.outline?.chapters.length ?? context.state.request.chapterCount;
  const written = layout.mains.length;
  const extras = layout.chapters.filter((chapter) => chapter.extra).map((chapter) => chapter.label);
  return [
    `## Where the fic is`,
    `${written} of ${planned} planned chapters are written.${extras.length > 0 ? ` Extra chapters: ${extras.join(", ")}.` : ""}`,
  ].join("\n");
}

/** What the fic is, as it is now: everything a comment thread's prompts read besides their own instructions. */
function ficSegments(context: FanficCommentContext): FanficPromptSegment[] {
  const { request, outline } = context.state;
  const canon = fanficCanonLine(fanficChapterLayout(context.ficMessages));
  return [
    // Markdown headings, not XML tags: a common outgoing-prompt regex ("Clean HTML") strips tags.
    { displayName: "Content Rules", content: `## Content rules\n${fanficContentRules(request)}` },
    { displayName: "Request", content: `## The request\n${renderFanficRequestForPrompt(request)}` },
    { displayName: "Outline", content: outline ? `## The outline\n${renderFanficOutline(outline)}` : "" },
    { displayName: "Progress", content: writtenSection(context) },
    { displayName: "Story Ledger", content: renderFanficLedgerForPrompt(readFanficLedger(context.ficMetadata), canon) },
    { displayName: "Voice Sheets", content: renderFanficVoiceSheets(context.state.voices) },
    { displayName: "Commented Chapter", content: chapterSection(context) },
  ].filter((segment) => segment.content.trim().length > 0);
}

/** The comment thread's system prompt, in place of the author's writing prompt. */
export function buildFanficCommentSegments(context: FanficCommentContext): FanficPromptSegment[] {
  return [{ displayName: "Fanfic Author Comments", content: AUTHOR_RULES }, ...ficSegments(context)];
}

/** What a thread's notes are for: rewriting the chapter it is under, or re-planning the chapters not written yet. */
export type FanficCommentUse = "rewrite" | "replan";

/** The re-plan steer's own cap (plan.ts); rewrite notes use the same, so the notes fit either box. */
export const FANFIC_COMMENT_NOTES_MAX_CHARS = 1500;
const NOTES_MAX_TOKENS = 1200;
/** The newest comments that fit; a long thread's opening is the least likely to hold what was settled. */
const TRANSCRIPT_MAX_CHARS = 40_000;
/** The model's answer when the thread never landed on a change. */
const NO_CHANGE = "NO CHANGE";

function threadTranscript(messages: readonly JsonRecord[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    const line = `${message.role === "assistant" ? "The author" : "The reader"}: ${readString(message.content).trim()}`;
    if (used + line.length > TRANSCRIPT_MAX_CHARS && lines.length > 0) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join("\n\n");
}

function chapterName(context: FanficCommentContext): string {
  const chapter = fanficChapterLayout(context.ficMessages).chapters.find(
    (entry) => entry.messageId === context.thread.chapterMessageId,
  );
  return `chapter ${chapter?.label ?? context.thread.chapterLabel}`;
}

/** The chapters a re-plan would change: the outline's unwritten ones, or the next one once the outline is used up. */
export function fanficReplanScope(state: FanficState, written: number): string {
  const total = state.outline?.chapters.length ?? 0;
  if (written >= total) return "the next chapter";
  return written + 1 === total ? `chapter ${total}` : `chapters ${written + 1} to ${total}`;
}

function notesTask(use: FanficCommentUse, context: FanficCommentContext): string {
  const settled = [
    "Use what the reader and the author settled on in the thread. If they never settled, use the option the reader leaned toward most recently; if the reader never leaned either way, the author's own pick. Leave out options that were turned down.",
    `If the thread never got to any change (only praise, or questions with no answer yet), reply with exactly ${NO_CHANGE}.`,
    `Write short plain lines addressed to the writer, at most ${FANFIC_COMMENT_NOTES_MAX_CHARS - 300} characters in all, with nothing before or after them: no heading, no quotes, no sign-off.`,
  ];
  if (use === "rewrite") {
    return [
      `Turn the comment thread above into the notes for rewriting ${chapterName(context)}: what this chapter should change and how, concretely enough for the writer to rewrite it without reading the thread.`,
      "Only what changes in this chapter. Mention a later chapter only where this one has to set something up for it.",
      ...settled,
    ].join("\n");
  }
  const scope = fanficReplanScope(context.state, fanficChapterLayout(context.ficMessages).mains.length);
  return [
    `Turn the comment thread above into a steer for re-planning ${scope}: the direction the rest of the story should take, and what it has to keep, so a planner can rework the outline without reading the thread.`,
    "Chapters already written stay as they are, so only steer what comes next.",
    ...settled,
  ].join("\n");
}

/** The prompt that turns a thread into notes, from the fic as it is now. */
function buildFanficCommentNotesMessages(
  context: FanficCommentContext,
  threadMessages: readonly JsonRecord[],
  use: FanficCommentUse,
): LlmMessage[] {
  const system = [
    "You are the author of this fanfic. The reader who requested it talked one of its chapters over with you in the chapter's comments, and now wants to act on that conversation.",
    ...ficSegments(context).map((segment) => segment.content),
  ].join("\n\n");
  const task = `## The comment thread\n${threadTranscript(threadMessages)}\n\n## What to write\n${notesTask(use, context)}`;
  return [
    { role: "system", content: system },
    { role: "user", content: task },
  ];
}

/** Trims a long reply at a line break under the cap. */
function capNotes(text: string): string {
  if (text.length <= FANFIC_COMMENT_NOTES_MAX_CHARS) return text;
  const cut = text.slice(0, FANFIC_COMMENT_NOTES_MAX_CHARS);
  const lineEnd = cut.lastIndexOf("\n");
  return (lineEnd > FANFIC_COMMENT_NOTES_MAX_CHARS / 2 ? cut.slice(0, lineEnd) : cut).trim();
}

/** The thread's comments in order, as saved (the version of each reply that is showing). */
async function threadMessages(storage: StorageGateway, threadChatId: string): Promise<JsonRecord[]> {
  return (await storage.listChatMessages<JsonRecord>(threadChatId))
    .filter(isRecord)
    .filter(
      (message) => (message.role === "user" || message.role === "assistant") && readString(message.content).trim(),
    )
    .sort((a, b) => readString(a.createdAt).localeCompare(readString(b.createdAt)));
}

/** The thread's own model, like its replies; the fic's model when that connection was deleted since. */
async function notesConnectionId(storage: StorageGateway, thread: JsonRecord, ficChatId: string): Promise<string> {
  const fic = await storage.get<JsonRecord>("chats", ficChatId);
  for (const candidate of [readString(thread.connectionId).trim(), readString(fic?.connectionId).trim()]) {
    if (candidate && (await loadFanficConnection(storage, candidate))) return candidate;
  }
  throw userFacingError(FANFIC_NO_CONNECTION);
}

/**
 * Drafts notes from a comment thread for the chapter's rewrite or for a re-plan, on the thread's own model. The
 * requester reads and edits them before anything is written; this changes nothing by itself.
 */
export async function draftFanficCommentNotes(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { threadChatId: string; use: FanficCommentUse },
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const chat = await deps.storage.get<JsonRecord>("chats", input.threadChatId);
  const context = isRecord(chat) ? await loadFanficCommentContext(deps.storage, chat.metadata) : null;
  if (!isRecord(chat) || !context) throw userFacingError("That comment thread is no longer here.");
  const messages = await threadMessages(deps.storage, input.threadChatId);
  if (!messages.some((message) => message.role === "assistant")) {
    throw userFacingError("Wait for the author's reply before using the thread.");
  }
  const connectionId = await notesConnectionId(deps.storage, chat, context.thread.ficChatId);
  const raw = await untilAborted(
    deps.llm.complete(
      {
        connectionId,
        messages: buildFanficCommentNotesMessages(context, messages, input.use),
        parameters: { maxTokens: NOTES_MAX_TOKENS, temperature: 0 },
      },
      options.signal,
    ),
    options.signal,
  );
  const notes = cleanFanficReply(raw).trim();
  if (!notes) throw userFacingError("The author didn't write any notes. Try again.");
  if (notes.replace(/[.\s]+$/, "").toUpperCase() === NO_CHANGE) {
    throw userFacingError(
      "This thread hasn't landed on a change yet. Talk it through a little more, or write the notes yourself.",
    );
  }
  return capNotes(notes);
}
