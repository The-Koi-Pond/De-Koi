// ──────────────────────────────────────────────
// Continuing a fic as a roleplay or a chat
// ──────────────────────────────────────────────
// The fic's model reads the fic and sets up a new roleplay or texting chat that picks up after its last chapter: the
// story so far goes in as the chat's summary (shown and editable in the chat's summaries), characters with no card get
// one written from the fic, the requester plays their own persona or one of the fic's characters, and the chat opens
// on a first message. The fic itself is left as it is.
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { effectiveMaxContext } from "../../generation/context-window";
import { boolish, isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { appendChatSummaryEntryToMetadata } from "../../shared/text/chat-summary-entries";
import { userFacingError } from "../../shared/user-facing-error";
import { fanficCanonLine, fanficChapterLayout } from "./chapter-refs";
import { readFanficLedger, renderFanficLedgerForPrompt } from "./ledger";
import {
  completeFanficJson,
  FANFIC_CONNECTION_GONE,
  FANFIC_NO_CONNECTION,
  fanficCallBudget,
  fanficMessageChars,
  FanficReplyParseError,
  loadFanficConnection,
  parseFanficJsonReply,
} from "./llm-json";
import { fanficStorySoFar } from "./plan";
import {
  fanficContentRules,
  renderFanficOutline,
  renderFanficRequestForPrompt,
  renderFanficVoiceSheets,
} from "./prompts";
import { readFanficState } from "./request";

export type FanficChatMode = "roleplay" | "conversation";

/** Who the requester plays in the new chat: their own persona, or one of the fic's characters. */
type FanficPlayAs = { kind: "persona" } | { kind: "character"; name: string };

export interface StartChatFromFanficInput {
  ficChatId: string;
  mode: FanficChatMode;
  /** The characters the AI plays, by name: one for a texting chat. */
  cast: string[];
  playAs: FanficPlayAs;
}

/** Where a chat made from a fic came from (`metadata.fanficOrigin`). */
interface FanficOrigin {
  version: 1;
  ficChatId: string;
  title: string;
}

const REPLY_MAX_TOKENS = 8000;
const STORY_DEFAULT_CHARS = 200_000;
const STORY_MAX_CHARS = 400_000;
/** The recap is the chat's summary, which every reply carries within a few thousand tokens. */
const RECAP_MAX_CHARS = 6000;

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface Card {
  id: string;
  name: string;
  description: string;
}

/** The fic's linked character cards, in the chat's order. */
async function linkedCards(storage: StorageGateway, fic: JsonRecord): Promise<Card[]> {
  const ids = Array.isArray(fic.characterIds)
    ? fic.characterIds.filter((id): id is string => typeof id === "string")
    : [];
  const rows = await Promise.all(ids.map((id) => storage.get<JsonRecord>("characters", id).catch(() => null)));
  return rows.filter(isRecord).map((row) => {
    const data = parseRecord(row.data);
    return {
      id: readString(row.id),
      name: readString(data.name).trim() || readString(row.name).trim(),
      description: readString(data.description).trim() || readString(row.description).trim(),
    };
  });
}

/** Everyone the fic is about: the request's characters, then any linked card it doesn't name. */
export function fanficCastNames(state: FanficState, cardNames: readonly string[]): string[] {
  const names = [...state.request.characters];
  for (const name of cardNames) if (name && !names.some((entry) => sameName(entry, name))) names.push(name);
  return names.filter((name) => name.trim());
}

interface Persona {
  id: string;
  name: string;
  description: string;
}

/** The fic's persona, else the active one: the requester's own character when they play themselves. */
async function ownPersona(storage: StorageGateway, fic: JsonRecord): Promise<Persona | null> {
  const pinned = readString(fic.personaId).trim();
  const row = pinned
    ? await storage.get<JsonRecord>("personas", pinned).catch(() => null)
    : (await storage.list<JsonRecord>("personas")).find(
        (persona) => boolish(persona.isActive, false) || boolish(persona.active, false),
      );
  if (!isRecord(row)) return null;
  const data = parseRecord(row.data);
  return {
    id: readString(row.id),
    name: readString(data.name).trim() || readString(row.name).trim() || "User",
    description: readString(data.description).trim() || readString(row.description).trim(),
  };
}

function validate(input: StartChatFromFanficInput): void {
  const cast = input.cast.map((name) => name.trim()).filter(Boolean);
  if (cast.length === 0) throw userFacingError("Pick at least one character for the AI to play.");
  if (input.mode === "conversation" && cast.length !== 1) {
    throw userFacingError("A chat is with one character. Pick one, or continue as a roleplay.");
  }
  if (
    input.playAs.kind === "character" &&
    cast.some((name) => sameName(name, (input.playAs as { name: string }).name))
  ) {
    throw userFacingError("You can't play a character the AI is playing too.");
  }
}

function buildMessages(args: {
  state: FanficState;
  title: string;
  story: string;
  ledger: string;
  mode: FanficChatMode;
  cast: string[];
  newCards: string[];
  user: { name: string; description: string; fromFic: boolean; needsPersona: boolean };
}): LlmMessage[] {
  const { state, mode, cast, newCards, user } = args;
  const castList = cast.join(", ");
  const rules = [
    `You are turning the fanfic "${args.title}" into a ${mode === "roleplay" ? "roleplay" : "texting chat"} that picks up after its last chapter. The requester who asked for the fic will play ${user.name}; the AI will play ${castList}.`,
    user.fromFic
      ? `${user.name} is a character in the fic.`
      : `${user.name} is the requester's own character and isn't in the fic${user.description ? `: ${user.description}` : ""}. Fit them in naturally: the first message sets up how ${castList} ${cast.length === 1 ? "knows or meets" : "know or meet"} them. Keep the fic's events as they were.`,
    "",
    "Reply with one JSON object and nothing else:",
    "{",
    `  "storySoFar": a recap of the fic through its last chapter, for the chat's memory: what happened, in order, in plain past-tense sentences; then where everyone is now, what each of them knows, their promises and the open threads. Facts only, no prose style, at most ${RECAP_MAX_CHARS - 1000} characters,`,
    newCards.length > 0
      ? `  "cards": a character card for each of ${newCards.join(", ")}, who have no card yet: [{ "name", "description": who they are, how they look, their history in the fic, what they want and how they talk (use the voice sheets), "personality": a short line of traits }],`
      : '  "cards": [],',
    user.needsPersona
      ? `  "persona": the requester's persona for ${user.name}: { "name", "description": who ${user.name} is as of the end of the fic, in the third person },`
      : '  "persona": null,',
    mode === "roleplay"
      ? `  "opening": the roleplay's first message, written for ${castList}: a scene that picks up right after the last chapter, or a little later, in the fic's tone. Third-person narration with dialogue, like a roleplay reply, two to five paragraphs. Give ${user.name} something to react to, and never write ${user.name}'s actions, words or thoughts.`
      : `  "opening": ${cast[0]}'s first text to ${user.name}, sent some time after the last chapter: one to three short texts separated by blank lines, in ${cast[0]}'s own voice, the way they would type on a phone. No narration.`,
    "}",
  ].join("\n");
  const sections = [
    `## Content rules\n${fanficContentRules(state.request)}`,
    `## The request\n${renderFanficRequestForPrompt(state.request)}`,
    state.outline ? `## The outline\n${renderFanficOutline(state.outline)}` : "",
    args.ledger,
    renderFanficVoiceSheets(state.voices),
    `## The fic so far\n${args.story}`,
  ].filter((section) => section.trim());
  return [
    { role: "system", content: rules },
    { role: "user", content: `${sections.join("\n\n")}\n\nWrite the JSON now.` },
  ];
}

interface Setup {
  storySoFar: string;
  cards: Array<{ name: string; description: string; personality: string }>;
  persona: { name: string; description: string } | null;
  opening: string;
}

function parseSetup(raw: string, newCards: readonly string[], needsPersona: boolean): Setup {
  const reply = parseFanficJsonReply(raw);
  const storySoFar = readString(reply?.storySoFar).trim();
  const opening = readString(reply?.opening).trim();
  if (!reply || !storySoFar || !opening) throw new FanficReplyParseError("The setup is missing the recap or opening.");
  const cards = (Array.isArray(reply.cards) ? reply.cards : []).filter(isRecord).map((card) => ({
    name: readString(card.name).trim(),
    description: readString(card.description).trim(),
    personality: readString(card.personality).trim(),
  }));
  for (const name of newCards) {
    if (!cards.some((card) => sameName(card.name, name) && card.description)) {
      throw new FanficReplyParseError(`The setup has no card for ${name}.`);
    }
  }
  const persona = isRecord(reply.persona)
    ? { name: readString(reply.persona.name).trim(), description: readString(reply.persona.description).trim() }
    : null;
  if (needsPersona && !persona?.description) throw new FanficReplyParseError("The setup has no persona.");
  return { storySoFar: storySoFar.slice(0, RECAP_MAX_CHARS), cards, persona, opening };
}

function cardData(name: string, card: { description: string; personality: string }, title: string): JsonRecord {
  return {
    name,
    description: card.description,
    personality: card.personality,
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: `Written from the fic "${title}".`,
    system_prompt: "",
    post_history_instructions: "",
    creator: "",
    character_version: "1.0",
    tags: [],
    alternate_greetings: [],
    extensions: {},
    character_book: null,
  };
}

/**
 * Starts a roleplay or texting chat from a fic, picking up after its last chapter. Returns the new chat. Cards for
 * characters without one, and a persona when the requester plays a fic character without a card, are added to the
 * library.
 */
export async function startChatFromFanfic(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: StartChatFromFanficInput,
  options: { signal?: AbortSignal } = {},
): Promise<JsonRecord> {
  validate(input);
  const fic = await deps.storage.get<JsonRecord>("chats", input.ficChatId);
  const state = isRecord(fic) && readString(fic.mode) === "fanfic" ? readFanficState(fic.metadata) : null;
  if (!isRecord(fic) || !state || readString(fic.ownerChatId).trim())
    throw userFacingError("That fic is no longer here.");
  const layout = fanficChapterLayout(
    (await deps.storage.listChatMessages<JsonRecord>(input.ficChatId)).filter(isRecord),
  );
  const story = fanficCanonLine(layout);
  if (story.length === 0) throw userFacingError("Write a chapter first: the chat picks up after the last one.");

  const connectionId = readString(fic.connectionId).trim();
  if (!connectionId) throw userFacingError(FANFIC_NO_CONNECTION);
  const connection = await loadFanficConnection(deps.storage, connectionId);
  if (!connection) throw userFacingError(FANFIC_CONNECTION_GONE);

  const cards = await linkedCards(deps.storage, fic);
  const cardFor = (name: string) => cards.find((card) => sameName(card.name, name));
  const cast = input.cast.map((name) => name.trim()).filter(Boolean);
  const newCards = cast.filter((name) => !cardFor(name));
  const own = input.playAs.kind === "persona" ? await ownPersona(deps.storage, fic) : null;
  const playName = input.playAs.kind === "character" ? input.playAs.name.trim() : (own?.name ?? "User");
  const playCard = input.playAs.kind === "character" ? cardFor(playName) : undefined;
  const user = {
    name: playName,
    description: own?.description ?? playCard?.description ?? "",
    fromFic: input.playAs.kind === "character",
    needsPersona: input.playAs.kind === "character" && !playCard,
  };
  const title = state.outline?.title.trim() || readString(fic.name).trim() || "Untitled";
  const ledger = renderFanficLedgerForPrompt(readFanficLedger(fic.metadata), story);
  const frame = { state, title, ledger, mode: input.mode, cast, newCards, user };
  const budget = fanficCallBudget(effectiveMaxContext(connection, {}), {
    maxReplyTokens: REPLY_MAX_TOKENS,
    fixedChars: fanficMessageChars(buildMessages({ ...frame, story: "" })),
    defaultChars: STORY_DEFAULT_CHARS,
    maxChars: STORY_MAX_CHARS,
    what: "continuing this fic as a chat",
  });
  const setup = await completeFanficJson(
    deps.llm,
    {
      connectionId,
      messages: buildMessages({ ...frame, story: fanficStorySoFar(story, fic.metadata, budget.proseChars) }),
      maxTokens: budget.replyTokens,
    },
    (raw) => parseSetup(raw, newCards, user.needsPersona),
    options.signal,
  );
  if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  // Nothing is saved until the setup is in hand, so a failed or stopped setup leaves no stray cards behind.
  const castIds: string[] = [];
  for (const name of cast) {
    const existing = cardFor(name);
    if (existing) {
      castIds.push(existing.id);
      continue;
    }
    const card = setup.cards.find((entry) => sameName(entry.name, name))!;
    const created = await deps.storage.create<JsonRecord>("characters", { name, data: cardData(name, card, title) });
    castIds.push(readString(created.id));
  }
  let personaId = own?.id || null;
  if (input.playAs.kind === "character") {
    const persona = await deps.storage.create<JsonRecord>("personas", {
      name: playName,
      description: playCard?.description || setup.persona?.description || "",
    });
    personaId = readString(persona.id) || null;
  }

  const summary = appendChatSummaryEntryToMetadata(
    {},
    { title: `The story so far: ${title}`, content: setup.storySoFar },
  );
  const origin: FanficOrigin = { version: 1, ficChatId: input.ficChatId, title };
  const lorebooks = parseRecord(fic.metadata).activeLorebookIds;
  const chat = await deps.storage.create<JsonRecord>("chats", {
    name: `${title} (${input.mode === "roleplay" ? "roleplay" : "chat"})`,
    mode: input.mode,
    characterIds: castIds,
    groupId: null,
    folderId: null,
    personaId,
    promptPresetId: null,
    connectionId,
    connectedChatId: null,
    metadata: {
      summaryEntries: summary.entries,
      summary: summary.summary,
      activeLorebookIds: Array.isArray(lorebooks) ? lorebooks : [],
      fanficOrigin: origin,
    },
  });
  const chatId = readString(chat.id);
  await deps.storage.createChatMessage(chatId, {
    chatId,
    role: "assistant",
    characterId: castIds[0] ?? null,
    content: setup.opening,
    activeSwipeIndex: 0,
    extra: {},
    swipes: [{ content: setup.opening }],
  });
  return chat;
}
