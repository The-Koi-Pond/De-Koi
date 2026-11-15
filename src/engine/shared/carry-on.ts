// ──────────────────────────────────────────────
// Carrying a chat on as a roleplay, a roleplay on as a chat, or talking a trance session over with its guide
// ──────────────────────────────────────────────
// The source's model reads it and sets up a new chat in the other mode that picks up where it stopped: the story so far
// goes in as the new chat's summary (shown and editable in its summaries), and it opens on a first message in the new
// mode's style. A trance session carries on as texts with its guide, who checks in on how it went. The characters, persona, model and lorebooks come along; the source itself is left as it is. Linking
// the two (the existing conversation ↔ roleplay link) is the caller's step, since it goes through the chat commands.
import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { extractLeadingThinkingBlocks } from "../generation-core/llm/inline-thinking";
import { loadCharacters, loadPersona } from "../generation/prompt-assembly";
import { isRecord, parseRecord, readString, type JsonRecord } from "../generation/runtime-records";
import { parseGameJsonish } from "./parsing-jsonish";
import { appendChatSummaryEntryToMetadata } from "./text/chat-summary-entries";
import { sourceConnectionId, sourceTranscriptBudget } from "./text/chat-source";
import { chatTranscriptLines, fitTranscript, tranceSessionLines } from "./text/chat-transcript";
import { untilAborted } from "./until-aborted";
import { userFacingError } from "./user-facing-error";

export type CarryOnMode = "conversation" | "roleplay";

/** What each kind of chat carries on as. */
const TARGETS: Record<string, CarryOnMode> = {
  conversation: "roleplay",
  roleplay: "conversation",
  visual_novel: "conversation",
  trance: "conversation",
};

/** The mode a chat of this mode carries on as, or null when it can't. */
export function carryOnTarget(mode: string): CarryOnMode | null {
  return TARGETS[mode] ?? null;
}

/** Whether the source and the new chat can share the conversation ↔ roleplay link. */
export function canLinkCarriedChat(sourceMode: string, sourceIsLinked: boolean): boolean {
  return (sourceMode === "conversation" || sourceMode === "roleplay") && !sourceIsLinked;
}

const REPLY_TOKENS = 3000;
/** The recap is the new chat's summary, which every reply carries within a few thousand tokens. */
const RECAP_MAX_CHARS = 5000;
const PROFILE_MAX_CHARS = 1500;

class CarryOnParseError extends Error {}

function profile(name: string, description: string): string {
  const text = description.trim();
  return text ? `${name}: ${text.length > PROFILE_MAX_CHARS ? `${text.slice(0, PROFILE_MAX_CHARS)}…` : text}` : name;
}

function buildMessages(args: {
  sourceName: string;
  /** What the source is, as the prompt names it. */
  from: "texting chat" | "roleplay" | "hypnosis session";
  target: CarryOnMode;
  cast: string[];
  user: string;
  profiles: string[];
  summary: string;
  transcript: { text: string; left: number };
}): LlmMessage[] {
  const { from, target, cast, user } = args;
  const castList = cast.join(", ");
  const trance = from === "hypnosis session";
  const rules = [
    trance
      ? `${cast[0]} guided ${user} through the hypnosis session "${args.sourceName}". You are setting up a texting chat between them for afterwards, so they can talk it over. ${user} is the user; the AI plays ${cast[0]}.`
      : `You are carrying the ${from} "${args.sourceName}" on as a ${target === "roleplay" ? "roleplay, where they are together in person" : "texting chat"}. ${user} is the user's own character; the AI plays ${castList}.`,
    "Keep to what the source shows: don't invent history, and don't soften or heighten it.",
    "",
    "Reply with one JSON object and nothing else:",
    "{",
    trance
      ? `  "storySoFar": a recap of the session for the chat's memory: what it was for, the images, phrases and suggestions ${cast[0]} used, how it ended, and how ${user} felt before and said it went after. Facts only, no prose style, at most ${RECAP_MAX_CHARS - 1000} characters,`
      : `  "storySoFar": a recap of the ${from} for the new chat's memory: what happened, in order, in plain past-tense sentences; then where things stand now: where everyone is, what each of them knows, their promises, running jokes and open threads. Facts only, no prose style, at most ${RECAP_MAX_CHARS - 1000} characters,`,
    trance
      ? `  "opening": ${cast[0]}'s first text to ${user} after the session: checking in on how they feel now and inviting them to talk it over, in ${cast[0]}'s own voice, the way they would type on a phone. One to three short texts separated by blank lines. No narration, no actions, and no new hypnosis.`
      : target === "roleplay"
        ? `  "opening": the roleplay's first message, written for ${castList}: a scene where they are with ${user} in person, picking up from where the texts left off (a plan they made, a meeting, or a little later), in the tone they have built. Third-person narration with dialogue, like a roleplay reply, two to four paragraphs. Give ${user} something to react to, and never write ${user}'s actions, words or thoughts.`
        : `  "opening": ${cast[0]}'s first text to ${user}, sent some time after the roleplay's latest scene (or right after, when that fits): one to three short texts separated by blank lines, in ${cast[0]}'s own voice, the way they would type on a phone. No narration and no actions.`,
    "}",
  ].join("\n");
  const sections = [
    `## Who is in it\n${args.profiles.join("\n\n")}`,
    args.summary.trim() ? `## Earlier, in summary\n${args.summary.trim()}` : "",
    `## The ${from}${trance ? ", in order" : ", oldest first"}${args.transcript.left > 0 ? ` (the first ${args.transcript.left} messages are left out; the summary covers them when there is one)` : ""}\n${args.transcript.text}`,
  ].filter(Boolean);
  return [
    { role: "system", content: rules },
    { role: "user", content: `${sections.join("\n\n")}\n\nWrite the JSON now.` },
  ];
}

function parseSetup(raw: string): { storySoFar: string; opening: string } {
  let reply: unknown = null;
  try {
    reply = parseGameJsonish(extractLeadingThinkingBlocks(raw).cleanText);
  } catch {
    reply = null;
  }
  const storySoFar = isRecord(reply) ? readString(reply.storySoFar).trim() : "";
  const opening = isRecord(reply) ? readString(reply.opening).trim() : "";
  if (!storySoFar || !opening) throw new CarryOnParseError("The setup is missing the recap or the opening.");
  return { storySoFar: storySoFar.slice(0, RECAP_MAX_CHARS), opening };
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

/**
 * Carries a chat on as a roleplay, or a roleplay on as a chat (with one of its characters: `characterId`, else the
 * first). Returns the new chat, which opens on its first message with the story so far in its summaries.
 */
export async function carryChatOn(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { chatId: string; characterId?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<JsonRecord> {
  const chat = await deps.storage.get<JsonRecord>("chats", input.chatId);
  if (!isRecord(chat)) throw userFacingError("That chat is no longer here.");
  const target = carryOnTarget(readString(chat.mode).trim());
  if (!target) throw userFacingError("Only chats, roleplays and trance sessions can be carried on like this.");
  const fromTrance = readString(chat.mode) === "trance";
  const [messages, characters, persona] = await Promise.all([
    deps.storage.listChatMessages<JsonRecord>(input.chatId),
    loadCharacters(deps.storage, chat),
    loadPersona(deps.storage, chat),
  ]);
  const picked = characters.find((character) => character.id === input.characterId?.trim()) ?? characters[0];
  const cast = target === "roleplay" ? characters : picked ? [picked] : [];
  if (cast.length === 0) throw userFacingError("This chat has no character to carry it on with.");
  const user = persona?.name.trim() || "The user's character";
  const lines = fromTrance
    ? tranceSessionLines(chat.metadata, { guide: cast[0]!.name, listener: user })
    : chatTranscriptLines(messages.filter(isRecord), {
        characters: new Map(characters.map((character) => [character.id, character.name])),
        only: characters.length === 1 ? characters[0]!.name : null,
        persona: user,
      });
  if (!lines.some((line) => !line.note)) {
    throw userFacingError(
      fromTrance
        ? "This session hasn't been written yet, so there's nothing to talk over."
        : "There's nothing in this chat to carry on yet.",
    );
  }

  const connectionId = await sourceConnectionId(deps.storage, chat);
  const sourceName = readString(chat.name).trim() || "Untitled";
  const metadata = parseRecord(chat.metadata);
  const messagesFor = (transcript: { text: string; left: number }) =>
    buildMessages({
      sourceName,
      from: fromTrance ? "hypnosis session" : target === "roleplay" ? "texting chat" : "roleplay",
      target,
      cast: cast.map((character) => character.name),
      user,
      profiles: [
        ...characters.map((character) => profile(character.name, character.description)),
        profile(`${user} (the user's character)`, persona?.description ?? ""),
      ],
      summary: readString(metadata.summary),
      transcript,
    });
  const budget = await sourceTranscriptBudget(deps.storage, connectionId, REPLY_TOKENS);
  const request = { connectionId, messages: messagesFor(fitTranscript(lines, budget)) };
  let setup: { storySoFar: string; opening: string } | null = null;
  for (let attempt = 0; !setup; attempt += 1) {
    const raw = await untilAborted(
      deps.llm.complete({ ...request, parameters: { maxTokens: REPLY_TOKENS } }, options.signal),
      options.signal,
    );
    try {
      setup = parseSetup(raw);
    } catch (error) {
      if (attempt >= 1 || !(error instanceof CarryOnParseError)) throw error;
    }
  }
  if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  // Nothing is saved until the setup is in hand, so a failed or stopped setup leaves nothing behind.
  const summary = appendChatSummaryEntryToMetadata(
    {},
    { title: `${fromTrance ? "The session" : "The story so far"}: ${sourceName}`, content: setup.storySoFar },
  );
  const created = await deps.storage.create<JsonRecord>("chats", {
    name: `${sourceName} (${target === "roleplay" ? "roleplay" : "chat"})`,
    mode: target,
    characterIds: cast.map((character) => character.id),
    groupId: null,
    folderId: null,
    personaId: readString(chat.personaId).trim() || null,
    promptPresetId: null,
    connectionId,
    connectedChatId: null,
    metadata: {
      summaryEntries: summary.entries,
      summary: summary.summary,
      activeLorebookIds: stringIds(metadata.activeLorebookIds),
    },
  });
  const chatId = readString(created.id);
  await deps.storage.createChatMessage(chatId, {
    chatId,
    role: "assistant",
    characterId: cast[0]!.id,
    content: setup.opening,
    activeSwipeIndex: 0,
    extra: {},
    swipes: [{ content: setup.opening }],
  });
  return created;
}
