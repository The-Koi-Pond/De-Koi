// ──────────────────────────────────────────────
// Turning a chat or roleplay into a fic
// ──────────────────────────────────────────────
// The chat's model reads what happened in it and drafts an AO3-style request for a fic that retells that story. A new
// fic starts from the draft: the request form opens filled in, the requester changes anything and starts the fic as
// usual. Nothing is planned or written until then, and the chat itself is left as it is.
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import {
  FANFIC_POVS,
  FANFIC_RATINGS,
  FANFIC_SETTINGS,
  FANFIC_WARNINGS,
  type FanficRequest,
} from "../../contracts/types/fanfic";
import { resolveBackgroundTextConnection } from "../../generation/background-llm-connection";
import { effectiveMaxContext } from "../../generation/context-window";
import { loadCharacters, loadPersona } from "../../generation/prompt-assembly";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import {
  completeFanficJson,
  FANFIC_NO_CONNECTION,
  fanficCallBudget,
  fanficMessageChars,
  FanficReplyParseError,
  loadFanficConnection,
  parseFanficJsonReply,
} from "./llm-json";
import { FANFIC_LINK_MODES, linkFanficChat } from "./links";
import { defaultFanficRequest, normalizeFanficRequest } from "./request";

/** The chat modes a fic can be made from. */
export const FANFIC_SOURCE_MODES: ReadonlySet<string> = new Set(["conversation", "roleplay", "visual_novel"]);

/** Where a fic made from a chat came from (`metadata.fanficSource`). */
export interface FanficSource {
  version: 1;
  chatId: string;
  mode: string;
  name: string;
}

const DRAFT_MAX_TOKENS = 3000;
/** A card's or persona's description is context here, not the point: the transcript is. */
const PROFILE_MAX_CHARS = 1500;
const TRANSCRIPT_DEFAULT_CHARS = 120_000;
const TRANSCRIPT_MAX_CHARS = 200_000;
const MAX_CHAPTERS = 12;

/** The request a fic made from a chat starts with, until the requester submits the form; null for any other fic. */
export function readFanficDraftRequest(metadata: unknown): FanficRequest | null {
  const raw = parseRecord(metadata).fanficDraftRequest;
  return isRecord(raw) ? normalizeFanficRequest(raw) : null;
}

export function readFanficSource(metadata: unknown): FanficSource | null {
  const raw = parseRecord(parseRecord(metadata).fanficSource);
  const chatId = readString(raw.chatId).trim();
  if (raw.version !== 1 || !chatId) return null;
  return { version: 1, chatId, mode: readString(raw.mode), name: readString(raw.name) };
}

interface Speaker {
  role: string;
  name: string;
  content: string;
  note: boolean;
}

/** The chat's messages in order, each with who said it. Hidden notes (scene summaries) stay in, marked as notes. */
function speakers(
  messages: readonly JsonRecord[],
  names: { characters: Map<string, string>; only: string | null; persona: string },
): Speaker[] {
  return [...messages]
    .filter((message) => ["user", "assistant", "narrator"].includes(readString(message.role)))
    .filter((message) => readString(message.content).trim())
    .sort((a, b) => readString(a.createdAt).localeCompare(readString(b.createdAt)))
    .map((message) => {
      const role = readString(message.role);
      const name =
        role === "user"
          ? names.persona
          : role === "narrator"
            ? "Narrator"
            : (names.characters.get(readString(message.characterId)) ?? names.only ?? "Character");
      const extra = parseRecord(message.extra);
      return { role, name, content: readString(message.content).trim(), note: extra.hiddenFromUser === true };
    });
}

/** The newest lines that fit in `maxChars`, oldest first, and how many earlier ones were left out. */
function transcript(lines: readonly Speaker[], maxChars: number): { text: string; left: number } {
  const kept: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const text = line.note ? `(Story note) ${line.content}` : `${line.name}: ${line.content}`;
    if (used + text.length > maxChars && kept.length > 0) return { text: kept.join("\n\n"), left: index + 1 };
    kept.unshift(text);
    used += text.length + 2;
  }
  return { text: kept.join("\n\n"), left: 0 };
}

function profile(name: string, description: string): string {
  const text = description.trim();
  return text ? `${name}: ${text.length > PROFILE_MAX_CHARS ? `${text.slice(0, PROFILE_MAX_CHARS)}…` : text}` : name;
}

const RULES = [
  "You turn a chat or roleplay into a request for a fanfic that retells its story as prose. The person who had the chat wants it written up as a fic, the way they would request one on AO3. Read the whole chat and fill in the request for them.",
  "",
  "Reply with one JSON object and nothing else:",
  "{",
  '  "fandom": the canon the characters come from when they are from an existing work, else "Original Work",',
  '  "existingCanon": true when the fandom is an existing work worth looking up, else false,',
  '  "characters": every character who matters, by name, the user\'s character included,',
  '  "relationships": the relationships the chat actually built, "A/B" for romantic, "A & B" for platonic,',
  `  "rating": one of ${FANFIC_RATINGS.map((value) => `"${value}"`).join(", ")}, for what the chat actually contains,`,
  `  "warnings": any of ${FANFIC_WARNINGS.map((value) => `"${value}"`).join(", ")} that the chat contains, else [],`,
  '  "tags": up to 10 tropes and tags, as on AO3,',
  `  "setting": one of ${FANFIC_SETTINGS.map((value) => `"${value}"`).join(", ")} relative to the fandom ("canon" for Original Work),`,
  '  "settingNotes": only when the setting isn\'t "canon": what is different from canon, else "",',
  `  "pov": one of ${FANFIC_POVS.map((value) => `"${value}"`).join(", ")}, the one this story reads best in,`,
  '  "povCharacter": whose point of view, when it is one character\'s,',
  `  "chapterCount": 1 for a short chat, more when it has distinct stages, at most ${MAX_CHAPTERS},`,
  '  "prompt": the story to write',
  "}",
  "",
  "The prompt is the heart of it. Open with a line or two on the world and on who the user's character is and what the chat established about them: the fic has no other record of them. Then retell what happened in the chat in order: how it starts, the turning points, the choices the characters made, how it ends or where it stopped. Name what has to carry over: key lines, promises, secrets, running jokes. Retell it; don't continue past where the chat stopped. Plain sentences, at most 4,000 characters.",
  "Keep to what the chat shows. Don't invent events, and don't soften or heighten it: the rating and warnings follow what is actually there.",
].join("\n");

function buildMessages(input: {
  chatName: string;
  characters: string[];
  persona: string;
  summary: string;
  transcript: { text: string; left: number };
}): LlmMessage[] {
  const parts = [
    `## The chat: ${input.chatName || "Untitled"}`,
    input.characters.length > 0 ? `## The characters\n${input.characters.join("\n\n")}` : "",
    `## The user's character\n${input.persona}`,
    input.summary.trim() ? `## What happened earlier, in summary\n${input.summary.trim()}` : "",
    `## The chat, oldest first${input.transcript.left > 0 ? ` (the first ${input.transcript.left} messages are left out; the summary covers them when there is one)` : ""}\n${input.transcript.text}`,
    "Write the request now.",
  ];
  return [
    { role: "system", content: RULES },
    { role: "user", content: parts.filter(Boolean).join("\n\n") },
  ];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The drafted request: the model's picks, the app's defaults for the rest. Adults are never confirmed for the requester. */
function parseDraft(raw: string): FanficRequest {
  const reply = parseFanficJsonReply(raw);
  if (!reply || !readString(reply.prompt).trim()) throw new FanficReplyParseError("The draft has no story prompt.");
  const chapters = Number(reply.chapterCount);
  const request = normalizeFanficRequest({
    ...defaultFanficRequest(),
    fandom: readString(reply.fandom),
    characters: stringList(reply.characters),
    relationships: stringList(reply.relationships),
    rating: readString(reply.rating),
    warnings: stringList(reply.warnings),
    tags: stringList(reply.tags).slice(0, 10),
    setting: readString(reply.setting),
    settingNotes: readString(reply.settingNotes),
    pov: readString(reply.pov),
    povCharacter: readString(reply.povCharacter),
    chapterCount: Number.isFinite(chapters) ? Math.min(MAX_CHAPTERS, Math.max(1, Math.round(chapters))) : undefined,
    prompt: readString(reply.prompt),
    adultsConfirmed: false,
    research: reply.existingCanon === true,
  });
  // The form only shows setting notes for a setting that isn't canon: nothing goes in that the requester can't see.
  return request.setting === "canon" ? { ...request, settingNotes: "" } : request;
}

/** The chat's own model, else the app's default text model. */
async function draftConnection(storage: StorageGateway, chat: JsonRecord): Promise<{ id: string; row: JsonRecord }> {
  const own = readString(chat.connectionId).trim();
  const row = own ? await loadFanficConnection(storage, own) : null;
  if (row) return { id: own, row };
  const fallback = await resolveBackgroundTextConnection(storage).catch(() => null);
  const id = readString(fallback?.id).trim();
  if (!fallback || !id) throw userFacingError(FANFIC_NO_CONNECTION);
  return { id, row: fallback };
}

function lorebookIds(chat: JsonRecord): string[] {
  const ids = parseRecord(chat.metadata).activeLorebookIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

/**
 * Makes a new fic from a chat or roleplay: drafts its request from the chat and creates the fic with the chat's
 * characters, lorebooks and model. Returns the new fic's chat; its request form opens filled in with the draft.
 */
export async function startFanficFromChat(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { chatId: string },
  options: { signal?: AbortSignal } = {},
): Promise<JsonRecord> {
  const chat = await deps.storage.get<JsonRecord>("chats", input.chatId);
  if (!isRecord(chat)) throw userFacingError("That chat is no longer here.");
  const mode = readString(chat.mode).trim();
  if (!FANFIC_SOURCE_MODES.has(mode)) throw userFacingError("Only chats and roleplays can be turned into a fic.");

  const [messages, characters, persona] = await Promise.all([
    deps.storage.listChatMessages<JsonRecord>(input.chatId),
    loadCharacters(deps.storage, chat),
    loadPersona(deps.storage, chat),
  ]);
  const personaName = persona?.name.trim() || "The user's character";
  const lines = speakers(messages.filter(isRecord), {
    characters: new Map(characters.map((character) => [character.id, character.name])),
    only: characters.length === 1 ? characters[0]!.name : null,
    persona: personaName,
  });
  if (!lines.some((line) => !line.note)) throw userFacingError("There's nothing in this chat to turn into a fic yet.");

  const connection = await draftConnection(deps.storage, chat);
  const frame = {
    chatName: readString(chat.name),
    characters: characters.map((character) => profile(character.name, character.description)),
    persona: profile(personaName, persona?.description ?? ""),
    summary: readString(parseRecord(chat.metadata).summary),
  };
  const budget = fanficCallBudget(effectiveMaxContext(connection.row, {}), {
    maxReplyTokens: DRAFT_MAX_TOKENS,
    fixedChars: fanficMessageChars(buildMessages({ ...frame, transcript: { text: "", left: 0 } })),
    defaultChars: TRANSCRIPT_DEFAULT_CHARS,
    maxChars: TRANSCRIPT_MAX_CHARS,
    what: "turning this chat into a fic",
  });
  const request = await completeFanficJson(
    deps.llm,
    {
      connectionId: connection.id,
      messages: buildMessages({ ...frame, transcript: transcript(lines, budget.proseChars) }),
      maxTokens: budget.replyTokens,
    },
    parseDraft,
    options.signal,
  );
  if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  const source: FanficSource = { version: 1, chatId: input.chatId, mode, name: readString(chat.name) };
  const fic = await deps.storage.create<JsonRecord>("chats", {
    name: `${readString(chat.name).trim() || "Untitled"} (fic)`,
    mode: "fanfic",
    characterIds: Array.isArray(chat.characterIds) ? chat.characterIds : [],
    groupId: null,
    folderId: null,
    personaId: readString(chat.personaId).trim() || null,
    promptPresetId: null,
    connectionId: connection.id,
    connectedChatId: null,
    metadata: { fanficDraftRequest: request, fanficSource: source, activeLorebookIds: lorebookIds(chat) },
  });
  // Linked both ways, so each knows what happens in the other from here on.
  if (FANFIC_LINK_MODES.has(mode)) {
    await linkFanficChat(deps.storage, { ficChatId: readString(fic.id), chatId: input.chatId });
  }
  return fic;
}
