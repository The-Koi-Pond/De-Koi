// ──────────────────────────────────────────────
// Trance mode: the chat, roleplay or fic a session is made from
// ──────────────────────────────────────────────
import type { StorageGateway } from "../../capabilities/storage";
import { loadCharacters, loadPersona } from "../../generation/prompt-assembly";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { chatTranscriptLines, fitTranscript } from "../../shared/text/chat-transcript";
import { userFacingError } from "../../shared/user-facing-error";

/** The modes a trance can be made from, and how a prompt names each. */
const SOURCE_KINDS: Record<string, TranceSourceKind> = {
  conversation: "chat",
  roleplay: "roleplay",
  visual_novel: "roleplay",
  fanfic: "fic",
};

type TranceSourceKind = "chat" | "roleplay" | "fic";

/** The chat modes a trance can be made from. */
export const TRANCE_SOURCE_MODES: ReadonlySet<string> = new Set(Object.keys(SOURCE_KINDS));

/** Where a session made from another chat came from (`metadata.tranceSource`). */
export interface TranceSource {
  version: 1;
  chatId: string;
  mode: string;
  name: string;
}

export function readTranceSource(metadata: unknown): TranceSource | null {
  const raw = parseRecord(parseRecord(metadata).tranceSource);
  const chatId = readString(raw.chatId).trim();
  if (raw.version !== 1 || !chatId) return null;
  return { version: 1, chatId, mode: readString(raw.mode), name: readString(raw.name) };
}

/** What a prompt needs from the source chat. */
export interface TranceSourceContext {
  kind: TranceSourceKind;
  name: string;
  /** The listener's own character there (their persona), or a plain stand-in. */
  listener: string;
  /** The chat's running summary, when it has one. */
  summary: string;
  /** The newest part of the chat (or the fic's chapters) that fits, oldest first. */
  transcript: string;
  /** How many earlier messages were left out. */
  left: number;
}

/**
 * Reads a chat, roleplay or fic as a source for a trance. A fic's chapters are its prose (the requests between them
 * are left out); a chat keeps who said what.
 */
export async function loadTranceSourceContext(
  storage: StorageGateway,
  chatId: string,
  maxChars: number,
): Promise<TranceSourceContext> {
  const chat = await storage.get<JsonRecord>("chats", chatId);
  if (!isRecord(chat)) throw userFacingError("The chat this trance comes from is no longer here.");
  const kind = SOURCE_KINDS[readString(chat.mode)];
  if (!kind) throw userFacingError("Only chats, roleplays and fics can be turned into a trance.");
  const [messages, characters, persona] = await Promise.all([
    storage.listChatMessages<JsonRecord>(chatId),
    loadCharacters(storage, chat),
    loadPersona(storage, chat),
  ]);
  const listener = persona?.name.trim() || (kind === "fic" ? "The reader" : "The user's character");
  let lines = chatTranscriptLines(messages.filter(isRecord), {
    characters: new Map(characters.map((character) => [character.id, character.name])),
    only: characters.length === 1 ? characters[0]!.name : null,
    persona: listener,
  });
  if (kind === "fic") {
    lines = lines.filter((line) => line.role === "assistant").map((line) => ({ ...line, name: "Chapter" }));
  }
  if (!lines.some((line) => !line.note)) {
    throw userFacingError(
      kind === "fic"
        ? "This fic has no chapters yet, so there's nothing to make a trance from."
        : "There's nothing in this chat to make a trance from yet.",
    );
  }
  const fitted = fitTranscript(lines, maxChars);
  return {
    kind,
    name: readString(chat.name).trim() || "Untitled",
    listener,
    summary: readString(parseRecord(chat.metadata).summary).trim(),
    transcript: fitted.text,
    left: fitted.left,
  };
}

const KIND_NAMES: Record<TranceSourceKind, string> = { chat: "chat", roleplay: "roleplay", fic: "fic" };

/** The source as a prompt section (markdown headings: a seeded outgoing-prompt regex strips XML-like tags). */
export function renderTranceSource(source: TranceSourceContext): string {
  const kind = KIND_NAMES[source.kind];
  return [
    `## The ${kind} it comes from: ${source.name}`,
    source.kind === "fic"
      ? "A fic the listener asked for with this character."
      : `The listener plays ${source.listener} in it.`,
    ...(source.summary ? ["", "### Earlier, in summary", source.summary] : []),
    "",
    `### The ${kind}, oldest first${source.left > 0 ? ` (the first ${source.left} messages are left out)` : ""}`,
    source.transcript,
  ].join("\n");
}
