// ──────────────────────────────────────────────
// Links between a fic and roleplays or chats
// ──────────────────────────────────────────────
// A linked fic and chat know what happens in each other. The fic's chapters are written with what happened in its
// linked chats since the previous chapter, to work in and never contradict; the chat's replies carry where the fic
// stands. A link is stored on both sides (`metadata.fanficLinkedChatIds` on the fic, `metadata.fanficLink` on the
// chat), and each side only counts it while the other side still points back, so a half-removed link does nothing.
import type { StorageGateway } from "../../capabilities/storage";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { normalizeChatSummaryMetadata } from "../../shared/text/chat-summary-entries";
import { userFacingError } from "../../shared/user-facing-error";
import { fanficCanonLine, fanficChapterLayout, type FanficChapterRef } from "./chapter-refs";
import { fanficLedgerStatus, readFanficLedger, renderFanficLedgerState } from "./ledger";
import { stripFanficChapterHeading } from "./prompts";
import { readFanficState } from "./request";

/** The chat modes a fic can be linked with. */
export const FANFIC_LINK_MODES: ReadonlySet<string> = new Set(["roleplay", "conversation"]);
export const FANFIC_MAX_LINKED_CHATS = 4;

/** What happened in one linked chat that a chapter is given; the newest lines are kept. */
const CHAT_EVENTS_MAX_CHARS = 8000;
const CHAT_SUMMARY_MAX_CHARS = 1500;
/** Where the fic stands, for a linked chat's replies. */
const FIC_STATE_MAX_CHARS = 5000;
const LAST_CHAPTER_TAIL_CHARS = 2500;

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

/** The fic a chat is linked to, as the chat stores it. */
export function readFanficLink(metadata: unknown): string | null {
  return readString(parseRecord(parseRecord(metadata).fanficLink).ficChatId).trim() || null;
}

/** The chats a fic is linked to, as the fic stores them. */
export function readFanficLinkedChatIds(metadata: unknown): string[] {
  return [...new Set(stringIds(parseRecord(metadata).fanficLinkedChatIds))];
}

function isFic(chat: unknown): chat is JsonRecord {
  return isRecord(chat) && readString(chat.mode) === "fanfic" && !readString(chat.ownerChatId).trim();
}

function isLinkableChat(chat: unknown): chat is JsonRecord {
  return isRecord(chat) && FANFIC_LINK_MODES.has(readString(chat.mode)) && !readString(chat.ownerChatId).trim();
}

/**
 * Links a fic and a chat both ways. A chat links to one fic at a time: linking it to another moves the link. A fic
 * links to at most {@link FANFIC_MAX_LINKED_CHATS} chats.
 */
export async function linkFanficChat(
  storage: StorageGateway,
  input: { ficChatId: string; chatId: string },
): Promise<void> {
  const [fic, chat] = await Promise.all([
    storage.get<JsonRecord>("chats", input.ficChatId),
    storage.get<JsonRecord>("chats", input.chatId),
  ]);
  if (!isFic(fic)) throw userFacingError("That fic is no longer here.");
  if (!isLinkableChat(chat)) throw userFacingError("Only roleplays and chats can be linked to a fic.");
  // Only links that still hold count: a deleted or unlinked chat's id is dropped here, as the reader drops it.
  const linked = (await listFanficLinkedChats(storage, fic))
    .map((row) => readString(row.id))
    .filter((id) => id !== input.chatId);
  if (linked.length >= FANFIC_MAX_LINKED_CHATS) {
    throw userFacingError(`A fic can be linked to ${FANFIC_MAX_LINKED_CHATS} chats at most. Unlink one first.`);
  }
  const previous = readFanficLink(chat.metadata);
  if (previous && previous !== input.ficChatId)
    await unlinkFanficChat(storage, { ficChatId: previous, chatId: input.chatId });
  await storage.patchChatMetadata(input.ficChatId, {
    fanficLinkedChatIds: [...linked, input.chatId],
  });
  await storage.patchChatMetadata(input.chatId, { fanficLink: { ficChatId: input.ficChatId } });
}

/** Removes a link from both sides; a side that is gone or already unlinked is left alone. */
export async function unlinkFanficChat(
  storage: StorageGateway,
  input: { ficChatId: string; chatId: string },
): Promise<void> {
  const [fic, chat] = await Promise.all([
    storage.get<JsonRecord>("chats", input.ficChatId).catch(() => null),
    storage.get<JsonRecord>("chats", input.chatId).catch(() => null),
  ]);
  if (isRecord(fic) && readFanficLinkedChatIds(fic.metadata).includes(input.chatId)) {
    await storage.patchChatMetadata(input.ficChatId, {
      fanficLinkedChatIds: readFanficLinkedChatIds(fic.metadata).filter((id) => id !== input.chatId),
    });
  }
  if (isRecord(chat) && readFanficLink(chat.metadata) === input.ficChatId) {
    await storage.patchChatMetadata(input.chatId, { fanficLink: null });
  }
}

/** The fic's linked chats that still point back, in link order. */
export async function listFanficLinkedChats(storage: StorageGateway, fic: JsonRecord): Promise<JsonRecord[]> {
  const ficChatId = readString(fic.id);
  const rows = await Promise.all(
    readFanficLinkedChatIds(fic.metadata).map((id) => storage.get<JsonRecord>("chats", id).catch(() => null)),
  );
  return rows.filter((row): row is JsonRecord => isLinkableChat(row) && readFanficLink(row.metadata) === ficChatId);
}

/** The chat's linked fic, while it still lists the chat. */
export async function loadLinkedFic(storage: StorageGateway, chat: JsonRecord): Promise<JsonRecord | null> {
  const ficChatId = readFanficLink(chat.metadata);
  if (!ficChatId) return null;
  const fic = await storage.get<JsonRecord>("chats", ficChatId).catch(() => null);
  return isFic(fic) && readFanficLinkedChatIds(fic.metadata).includes(readString(chat.id)) ? fic : null;
}

function keepNewest(lines: readonly string[], maxChars: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (used + line.length > maxChars) {
      if (kept.length === 0) kept.unshift(`…${line.slice(line.length - maxChars)}`);
      break;
    }
    kept.unshift(line);
    used += line.length + 1;
  }
  return kept;
}

async function speakerNames(
  storage: StorageGateway,
  chat: JsonRecord,
): Promise<{ characters: Map<string, string>; user: string }> {
  const ids = stringIds(chat.characterIds);
  const rows = await Promise.all(ids.map((id) => storage.get<JsonRecord>("characters", id).catch(() => null)));
  const characters = new Map<string, string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = readString(parseRecord(row.data).name).trim() || readString(row.name).trim();
    if (name) characters.set(readString(row.id), name);
  }
  const personaId = readString(chat.personaId).trim();
  const persona = personaId ? await storage.get<JsonRecord>("personas", personaId).catch(() => null) : null;
  const user =
    (isRecord(persona) && (readString(parseRecord(persona.data).name).trim() || readString(persona.name).trim())) ||
    "The user";
  return { characters, user };
}

function eventLines(
  messages: readonly JsonRecord[],
  names: { characters: Map<string, string>; user: string },
  since: string | null,
): string[] {
  const only = names.characters.size === 1 ? [...names.characters.values()][0]! : "Character";
  return [...messages]
    .filter((message) => ["user", "assistant", "narrator"].includes(readString(message.role)))
    .filter((message) => !parseRecord(message.extra).hiddenFromUser)
    .filter((message) => !since || readString(message.createdAt) > since)
    .sort((a, b) => readString(a.createdAt).localeCompare(readString(b.createdAt)))
    .flatMap((message) => {
      const content = readString(message.content).trim();
      if (!content) return [];
      const role = readString(message.role);
      const name =
        role === "user"
          ? names.user
          : role === "narrator"
            ? "Narrator"
            : (names.characters.get(readString(message.characterId)) ?? only);
      return [`${name}: ${content}`];
    });
}

function chatLabel(chat: JsonRecord): string {
  return `${readString(chat.mode) === "roleplay" ? "Roleplay" : "Chat"}: ${readString(chat.name).trim() || "Untitled"}`;
}

/**
 * For a chapter write: what happened in each linked chat since the fic's previous chapter (the newest chapter in the
 * write's context), with the chat's own summary. Empty when nothing is linked or nothing happened since.
 */
export async function buildFanficLinkedChatsSection(
  storage: StorageGateway,
  fic: JsonRecord,
  storedMessages: readonly JsonRecord[],
): Promise<string> {
  const chats = await listFanficLinkedChats(storage, fic);
  if (chats.length === 0) return "";
  const chapterTimes = storedMessages
    .filter((message) => readString(message.role) === "assistant")
    .map((message) => readString(message.createdAt))
    .filter(Boolean)
    .sort();
  const since = chapterTimes.at(-1) ?? null;
  const sections: string[] = [];
  for (const chat of chats) {
    const chatId = readString(chat.id);
    const [messages, names] = await Promise.all([
      storage.listChatMessages<JsonRecord>(chatId).catch(() => [] as JsonRecord[]),
      speakerNames(storage, chat),
    ]);
    const lines = keepNewest(eventLines(messages.filter(isRecord), names, since), CHAT_EVENTS_MAX_CHARS);
    if (lines.length === 0) continue;
    const summary = (normalizeChatSummaryMetadata(parseRecord(chat.metadata)).summary ?? "").trim();
    sections.push(
      [
        `### ${chatLabel(chat)}`,
        summary ? `What came before, in summary: ${summary.slice(-CHAT_SUMMARY_MAX_CHARS)}` : "",
        `${since ? "Since the previous chapter" : "So far"}:\n${lines.join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (sections.length === 0) return "";
  return [
    "## Meanwhile, in the linked chats",
    "These happened in the same story, in roleplays or chats the requester linked to this fic. Treat them as events of the story: work them into this chapter where they fit the outline and the notes, and never contradict them. Tell them as prose in the fic's own voice; don't copy the chat's lines or its formatting.",
    ...sections,
  ].join("\n\n");
}

function ficProgress(fic: JsonRecord, story: readonly FanficChapterRef[]): string {
  const state = readFanficState(fic.metadata);
  const planned = state?.outline?.chapters.length ?? state?.request.chapterCount ?? story.length;
  const title = state?.outline?.title.trim() || readString(fic.name).trim() || "Untitled";
  return `"${title}": ${story.length} of ${planned} planned chapters written.`;
}

/** Where the fic stands: the ledger's account when it covers every chapter, else how the latest chapter ends. */
function ficState(fic: JsonRecord, story: readonly FanficChapterRef[]): string {
  const fresh = fanficLedgerStatus(readFanficLedger(fic.metadata), story).fresh;
  if (fresh.length === story.length && fresh.length > 0) {
    const summaries = fresh.map((entry, index) => `Chapter ${story[index]!.label}: ${entry.summary}`).join("\n");
    const text = `${summaries}\n\nWhere things stand now:\n${renderFanficLedgerState(fresh.at(-1)!)}`;
    return text.length > FIC_STATE_MAX_CHARS ? `…${text.slice(text.length - FIC_STATE_MAX_CHARS)}` : text;
  }
  const last = story.at(-1)!;
  const prose = stripFanficChapterHeading(last.content).trim();
  const tail =
    prose.length > LAST_CHAPTER_TAIL_CHARS ? `…${prose.slice(prose.length - LAST_CHAPTER_TAIL_CHARS)}` : prose;
  // Without a ledger, the outline's plan for each written chapter says what the chapters cover.
  const outline = readFanficState(fic.metadata)?.outline;
  const planned = story
    .filter((chapter) => !chapter.extra)
    .flatMap((chapter) => {
      const plan = outline?.chapters.find((entry) => entry.number === chapter.mainNumber);
      return plan?.summary.trim() ? [`Chapter ${chapter.label}: ${plan.title}. ${plan.summary.trim()}`] : [];
    });
  return [
    planned.length > 0 ? `What the written chapters cover, as the outline planned them:\n${planned.join("\n")}` : "",
    `The latest chapter (${last.label}) ends:\n${tail}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** For a linked chat's reply: where the fic stands now. Null when the chat has no linked fic or it has no chapters. */
export async function buildLinkedFicContext(storage: StorageGateway, chat: JsonRecord): Promise<string | null> {
  if (!FANFIC_LINK_MODES.has(readString(chat.mode))) return null;
  const fic = await loadLinkedFic(storage, chat);
  if (!fic) return null;
  const messages = await storage.listChatMessages<JsonRecord>(readString(fic.id)).catch(() => [] as JsonRecord[]);
  const story = fanficCanonLine(fanficChapterLayout(messages.filter(isRecord)));
  if (story.length === 0) return null;
  return [
    `This chat is linked to the fic ${ficProgress(fic, story)} What happens in the fic is part of this story too: keep to it, and bring it up when it matters, without retelling it unprompted.`,
    ficState(fic, story),
  ].join("\n\n");
}
