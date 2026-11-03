// ──────────────────────────────────────────────
// Fanfic chapter comments: AO3-style threads under a chapter, answered by the fic's author
// ──────────────────────────────────────────────
// Each thread is a chat of its own. It names the fic as its `ownerChatId`, so it stays out of the chat lists and search
// and is deleted with the fic. It is in fanfic mode, so no persona, prompt preset, agent or memory recall reaches it,
// and its history is only its own comments. The ordinary chat reply pipeline answers it (streaming, Stop, redo with
// versions, the hosted runner); prompt assembly swaps the author's writing prompt for the comment prompt built here,
// read fresh from the fic on every reply.
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficCommentThread, FanficState } from "../../contracts/types/fanfic";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { fanficCanonLine, fanficChapterLayout } from "./chapter-refs";
import { fanficChapterTextKey, readFanficLedger, renderFanficLedgerForPrompt } from "./ledger";
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

/** The comment thread's system prompt, in place of the author's writing prompt. */
export function buildFanficCommentSegments(context: FanficCommentContext): FanficPromptSegment[] {
  const { request, outline } = context.state;
  const canon = fanficCanonLine(fanficChapterLayout(context.ficMessages));
  return [
    { displayName: "Fanfic Author Comments", content: AUTHOR_RULES },
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
