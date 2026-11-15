// ──────────────────────────────────────────────
// Trance mode: session ideas with a taste of each, before anything is written
// ──────────────────────────────────────────────
// Headings are markdown, not XML: a seeded outgoing-prompt regex strips XML-like tags.
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import {
  TRANCE_CATEGORIES,
  TRANCE_ENDINGS,
  TRANCE_FEATURES,
  TRANCE_LENGTHS,
  TRANCE_TYPES,
  type TranceMood,
  type TranceRequest,
} from "../../contracts/types/trance";
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import { loadCharacters } from "../../generation/prompt-assembly";
import { isRecord, readString } from "../../generation/runtime-records";
import { parseGameJsonish } from "../../shared/parsing-jsonish";
import { untilAborted } from "../../shared/until-aborted";
import { userFacingError } from "../../shared/user-facing-error";
import { renderTranceCharacterCard, type TranceCharacterCard } from "./prompts";
import { loadTranceSourceContext, renderTranceSource, tranceSourceBudget, type TranceSourceContext } from "./source";
import {
  TRANCE_CATEGORY_LABELS,
  TRANCE_FEATURE_LABELS,
  TRANCE_MOOD_LABELS,
  TRANCE_PITCH_SAMPLE_LIMIT,
  TRANCE_TYPE_LABELS,
  normalizeTranceRequest,
} from "./request";

/** One suggested session: what it is, its settings, and its first lines. */
export interface TrancePitch {
  title: string;
  summary: string;
  /** Ready to save: the settings plus this pitch as the picked idea. */
  request: TranceRequest;
}

export interface SuggestTranceInput {
  connectionId: string;
  characterId: string;
  moods: TranceMood[];
  moodNote: string;
  /** Their own idea, when they gave one; every suggestion builds on it. */
  idea: string;
  /** Preview exactly these settings (one pitch) instead of suggesting three. */
  exact?: TranceRequest | null;
  /** Titles already shown, so "Show me others" brings new ones. */
  avoidTitles?: string[];
  /** The chat, roleplay or fic the session is made from: every suggestion grows out of it. */
  sourceChatId?: string | null;
}

const SUGGESTION_COUNT = 3;
const MIN_SAMPLE_LINES = 2;
const REPLY_TOKENS = 1800;
/** Suggestions made from a chat also say what each draws on. */
const SOURCE_REPLY_TOKENS = 2600;

/** The reply couldn't be read as suggestions. */
export class TrancePitchParseError extends Error {
  /** Worded for the person: the screen shows it as is. */
  readonly code = "user_facing" as const;

  constructor() {
    super("The suggestions couldn't be read. Try again, or pick a different connection.");
    this.name = "TrancePitchParseError";
  }
}

const optionList = (values: readonly string[]) => values.map((value) => `"${value}"`).join(", ");

/** The rules for suggestions that grow out of a chat, roleplay or fic. */
function sourceRules(source: TranceSourceContext, exact: boolean): string[] {
  const kind = source.kind;
  return [
    `- basis: 1 to 3 plain sentences naming exactly what from the ${kind} this session draws on (a place, what the character calls the listener, a moment or promise they share), for whoever writes the full session. Call the listener "the listener" there, not by name.`,
    "",
    `## Made from a ${kind}`,
    `The listener wants a session that grows out of the ${kind} below. Build ${exact ? "it" : "every suggestion"} from it: its places and images, the bond between the character and the listener, the names and phrases the character uses for them, the feeling it had.${exact ? "" : " Each suggestion picks a different thread."}`,
    kind === "fic"
      ? "- Speak to the listener as a reader who has been through this story with the character."
      : `- The listener is ${source.listener} there; speak to them the way the character did by the end.`,
    "- A pet name the character gave them is welcome; never use their character's name (the session is for the person reading it) and never guess their gender.",
    "- The character speaks as themself, to the listener: never about themself in the third person, even when the source is told that way.",
    "- Don't retell it or quote long stretches; a detail or two they will recognise is enough.",
    "- Keep to what it shows; don't invent shared history.",
  ];
}

function buildTrancePitchSystemPrompt(exact: boolean, source: TranceSourceContext | null): string {
  return [
    exact
      ? "You give a taste of one text hypnosis session before it is written, in the voice of a character."
      : "You suggest text hypnosis sessions a character could guide, for someone who isn't sure what they want.",
    "The listener reads a session on a screen one short line at a time and presses a button to go on. They never type or reply.",
    "",
    "## Each suggestion",
    "- title: a short, evocative name (2 to 6 words).",
    "- summary: one plain sentence saying what happens and how it should feel. No jargon.",
    "- sample: the first 3 or 4 lines of the session, exactly as they would appear, in the character's voice: second person, short lines, permissive wording (might, perhaps, can), describing what is already true before suggesting anything. Never mention buttons, the app or stopping. Skip the stock opening (dropping shoulders, loosening the jaw, a body scan); open in this character's own voice, without reciting facts from their description.",
    `- type: one of ${optionList(TRANCE_TYPES)}.`,
    `- category: one of ${optionList(TRANCE_CATEGORIES)}.`,
    `- features: any of ${optionList(TRANCE_FEATURES)}; "arousal" and "orgasm" only with an erotic or kinky type.`,
    `- minutes: one of ${TRANCE_LENGTHS.join(", ")}.`,
    `- ending: one of ${optionList(TRANCE_ENDINGS)}.`,
    "- idea: the session's theme or central image in one short phrase.",
    ...(source ? sourceRules(source, exact) : []),
    ...(exact
      ? []
      : [
          "",
          "## The set",
          `- Exactly ${SUGGESTION_COUNT} suggestions that feel clearly different from each other (goal, imagery, pace).`,
          "- The first is gentle and simple: a safe pick for someone who just wants to feel better.",
          "- The others can lean into the character's own style and anything they said.",
          source
            ? `- Nothing sexual (type "erotic" or "kinky", or arousal or orgasm) unless the ${source.kind} itself was sexual or their words or idea ask for it.`
            : '- Nothing sexual (type "erotic", or arousal or orgasm) unless their words or idea ask for it.',
          "- Fit how they feel. If they gave an idea, every suggestion builds on it.",
        ]),
    "",
    "## Reply format",
    `Reply with JSON only: {"pitches": [{"title": "", "summary": "", "sample": [""], "type": "", "category": "", "features": [], "minutes": 10, "ending": "", "idea": ""${source ? ', "basis": ""' : ""}}]}`,
  ].join("\n");
}

function buildTrancePitchUserPrompt(
  input: SuggestTranceInput,
  card: TranceCharacterCard,
  source: TranceSourceContext | null,
): string {
  const feelings = [
    ...input.moods.map((mood) => TRANCE_MOOD_LABELS[mood]),
    ...(input.moodNote ? [`in their words: ${input.moodNote}`] : []),
  ];
  const exact = input.exact;
  return [
    "## The character",
    renderTranceCharacterCard(card),
    ...(source ? ["", renderTranceSource(source)] : []),
    "",
    "## How they feel today",
    feelings.length ? feelings.join("; ") : "They didn't say.",
    ...(input.idea ? ["", "## Their idea", input.idea] : []),
    ...(exact
      ? [
          "",
          "## The settings they chose (keep them exactly)",
          `Type: ${TRANCE_TYPE_LABELS[exact.type]}; category: ${TRANCE_CATEGORY_LABELS[exact.category]}; features: ${
            exact.features.map((feature) => TRANCE_FEATURE_LABELS[feature]).join(", ") || "none"
          }; ${exact.minutes} minutes; ending: ${exact.ending}.`,
        ]
      : []),
    ...(input.avoidTitles?.length
      ? ["", "## Already shown (suggest different ones)", ...input.avoidTitles.map((title) => `- ${title}`)]
      : []),
    "",
    exact ? "Give one taste of this session now." : `Suggest ${SUGGESTION_COUNT} sessions now.`,
  ].join("\n");
}

function buildTrancePitchMessages(
  input: SuggestTranceInput,
  card: TranceCharacterCard,
  source: TranceSourceContext | null,
): LlmMessage[] {
  return [
    { role: "system", content: buildTrancePitchSystemPrompt(!!input.exact, source) },
    { role: "user", content: buildTrancePitchUserPrompt(input, card, source) },
  ];
}

function jsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Reads the model's suggestions. Settings are normalized (so arousal can't ride on a gentle session), how they feel
 * is carried over from the input, and a preview keeps the chosen settings exactly whatever the model wrote.
 */
export function parseTrancePitchReply(raw: string, input: SuggestTranceInput): TrancePitch[] {
  let parsed: unknown = null;
  try {
    parsed = parseGameJsonish(jsonCandidate(extractLeadingThinkingBlocks(raw).cleanText));
  } catch {
    parsed = null;
  }
  const list = isRecord(parsed) && Array.isArray(parsed.pitches) ? parsed.pitches : [];
  const pitches = list.flatMap((item): TrancePitch[] => {
    if (!isRecord(item)) return [];
    const title = readString(item.title).trim();
    const summary = readString(item.summary).trim();
    const sample = Array.isArray(item.sample)
      ? item.sample
          .map((line) => readString(line).trim())
          .filter(Boolean)
          .slice(0, TRANCE_PITCH_SAMPLE_LIMIT)
      : [];
    if (!title || sample.length < MIN_SAMPLE_LINES) return [];
    const settings = input.exact ? { ...input.exact } : { ...item, idea: readString(item.idea).trim() || input.idea };
    // What a session made from a chat draws on: a preview keeps the one it was given (it may have been edited).
    const fromSource = input.sourceChatId ? readString(item.basis).trim() : "";
    const basis = input.exact ? input.exact.basis || fromSource : fromSource;
    const request = normalizeTranceRequest({
      ...settings,
      moods: input.moods,
      moodNote: input.moodNote,
      pitch: { title, summary, sample },
      basis,
    });
    return [{ title, summary, request }];
  });
  if (pitches.length === 0) throw new TrancePitchParseError();
  return pitches.slice(0, input.exact ? 1 : SUGGESTION_COUNT);
}

const TRANCE_PITCH_NO_CONNECTION = "Pick a model connection first.";
const TRANCE_PITCH_NO_CHARACTER = "Pick a character first.";

/**
 * Suggests three sessions (or, with `exact`, previews one) on the given connection, in the given character's voice.
 * Nothing is saved: picking one fills the request. A reply that can't be read gets one retry.
 */
export async function suggestTrancePitches(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: SuggestTranceInput,
  signal?: AbortSignal,
): Promise<TrancePitch[]> {
  const connectionId = input.connectionId.trim();
  if (!connectionId) throw userFacingError(TRANCE_PITCH_NO_CONNECTION);
  const [character] = await loadCharacters(deps.storage, { characterIds: [input.characterId] });
  if (!character) throw userFacingError(TRANCE_PITCH_NO_CHARACTER);
  const card: TranceCharacterCard = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    mesExample: character.mesExample,
  };
  const sourceChatId = input.sourceChatId?.trim() || null;
  const maxTokens = sourceChatId ? SOURCE_REPLY_TOKENS : REPLY_TOKENS;
  const source = sourceChatId
    ? await loadTranceSourceContext(
        deps.storage,
        sourceChatId,
        await tranceSourceBudget(deps.storage, connectionId, maxTokens),
      )
    : null;
  const messages = buildTrancePitchMessages(input, card, source);
  for (let attempt = 0; ; attempt += 1) {
    const raw = await untilAborted(
      deps.llm.complete({ connectionId, messages, parameters: { maxTokens, temperature: 1 } }, signal),
      signal,
    );
    try {
      return parseTrancePitchReply(raw, input);
    } catch (error) {
      if (attempt >= 1 || !(error instanceof TrancePitchParseError)) throw error;
    }
  }
}
