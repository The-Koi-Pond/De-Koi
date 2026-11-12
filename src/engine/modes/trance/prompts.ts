// ──────────────────────────────────────────────
// Trance mode: the script-writing prompt
// ──────────────────────────────────────────────
// Headings are markdown, not XML: a seeded outgoing-prompt regex strips XML-like tags.
import type { LlmMessage } from "../../capabilities/llm";
import type { TranceFeature, TranceMood, TranceRequest } from "../../contracts/types/trance";
import { TRANCE_ENDING_LABELS, tranceTargetLines } from "./request";

/** The character as the script writer sees them. */
export interface TranceCharacterCard {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mesExample?: string;
}

const CARD_FIELD_LIMIT = 1800;

function cardField(label: string, value: string | undefined, name: string): string {
  const resolved = (value ?? "")
    .replace(/\{\{char\}\}/gi, name)
    .replace(/\{\{user\}\}/gi, "the listener")
    .trim();
  if (!resolved) return "";
  const text = resolved.length > CARD_FIELD_LIMIT ? `${resolved.slice(0, CARD_FIELD_LIMIT).trimEnd()}…` : resolved;
  return `${label}: ${text}`;
}

export function renderTranceCharacterCard(card: TranceCharacterCard): string {
  const name = card.name.trim() || "The hypnotist";
  return [
    `### ${name}`,
    cardField("Description", card.description, name),
    cardField("Personality", card.personality, name),
    cardField("Usual setting", card.scenario, name),
    cardField("How they talk (examples)", card.mesExample, name),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The section headings the reply uses, in order. Exits come last and are never read in the main session. */
const TRANCE_REPLY_HEADINGS = {
  pretalk: "## pretalk",
  induction: "## induction",
  deepener: "## deepener",
  suggestions: "## suggestions",
  wake: "## wake",
  sleep: "## sleep",
  exitGentle: "## exit: gentle",
  exitCalm: "## exit: calm",
} as const;

const MOOD_OPENINGS: Record<TranceMood, string> = {
  calm: "They arrive calm. Build on that ease; you can go a little faster into the induction.",
  good: "They arrive in a good mood. Keep it light and enjoyable; the session is a treat, not a fix.",
  stressed:
    "They arrive stressed. Acknowledge the weight without naming causes, then set it down piece by piece before deepening.",
  overwhelmed:
    "They arrive overwhelmed. Make everything smaller: very short lines, one simple thing at a time, nothing to figure out.",
  sad: "They arrive sad. Be gentle and warm; let the sadness be allowed without trying to cheer them up.",
  lonely: "They arrive lonely. Let your presence be felt: you are here with them the whole time, attentive and close.",
  numb: "They arrive numb. Don't demand big feelings; start with small, simple sensations and let warmth come slowly.",
  anxious:
    "They arrive anxious. Open by acknowledging the worry without asking about it, let it be there, and slow everything down: longer breathing, more pacing, more permission, before any deepening.",
  wired:
    "They arrive wired and restless. Give the restlessness something to do first (counting, tracking breath, watching the words), then let it run down. A longer induction helps.",
  tired: "They arrive tired. Let the tiredness help: heaviness comes easily. Keep lines short and soft.",
  low: "They arrive feeling low. Be warm and unhurried, no pep talk and no fixing; let the session be a rest from it.",
  foggy:
    "They arrive foggy. Keep every line simple and concrete; use the fog as part of the drift instead of fighting it.",
  blank: "They want their head empty. Lean into quiet, emptiness and letting thoughts go.",
};

const FEATURE_RULES: Record<TranceFeature, string> = {
  fractionation:
    "Fractionation: two or three times, bring them up a little toward waking, then let them drop back deeper than before.",
  amnesia:
    "Amnesia: suggest the details soften and float away while the good feeling stays. Never suggest forgetting anything outside this session.",
  obedience:
    "Obedience: suggestions of following your words, yielding and enjoying doing as they're told, for the length of the session.",
  arousal: "Arousal: build sexual arousal through the suggestions.",
  orgasm: "Orgasm: lead up to an orgasm before the ending; describe it as allowed, never demanded on the clock.",
};

const TYPE_TONES: Record<TranceRequest["type"], string> = {
  gentle: "Gentle: soft and caring, nothing sexual.",
  erotic: "Erotic: sensual and sexual content is welcome where it fits the picked features.",
  kinky: "Kinky: dominance, power exchange and control play, in the character's own style.",
};

const CATEGORY_GOALS: Record<TranceRequest["category"], string> = {
  relax: "Relax: deep calm and rest. The suggestions are about letting go and feeling good.",
  sleep: "Sleep: settle the body and mind toward sleep. The suggestions are about heaviness, safety and drifting.",
  fantasy: "Fantasy: a guided scene the listener sinks into, built from the idea if there is one.",
  transformation: "Transformation: a playful, temporary change of form or role, felt from the inside.",
  effect:
    "Effect: one clear, temporary hypnotic effect (heaviness, stuck hand, a feeling on a word) built up and enjoyed.",
};

function sectionShares(target: number, ending: TranceRequest["ending"]): string {
  const share = (fraction: number) => Math.max(3, Math.round(target * fraction));
  return [
    `- pretalk: ${Math.min(8, Math.max(3, Math.round(target * 0.05)))} lines`,
    `- induction: about ${share(0.27)} lines`,
    `- deepener: about ${share(0.23)} lines`,
    `- suggestions: about ${share(0.33)} lines`,
    ending === "wake" ? `- wake: about ${share(0.12)} lines` : `- sleep: about ${share(0.12)} lines`,
  ].join("\n");
}

export function buildTranceSystemPrompt(): string {
  return [
    "You write text hypnosis sessions in the voice of a character. The listener reads the session on a screen, one line at a time, and presses a button to see the next line. They do not type or reply.",
    "",
    "## How lines work",
    "- One short sentence or fragment per line, usually under 15 words. Each line is its own screen.",
    "- Rhythm and repetition are good. A single word can be a line.",
    "- Their eyes stay open to read. Suggest softening focus, heavy eyelids and slow blinks, but never ask them to close their eyes until the sleep ending.",
    "- Second person. Never name the listener or guess their gender.",
    "- The app shows its own buttons and ways out. Never mention buttons, exits, stopping, the app or this format in the session itself.",
    "- These instructions describe what to do, not what to say. Put every idea in the character's own words; never reuse the wording here.",
    "",
    "## How to hypnotise someone who may not feel it",
    "- Start permissive: might, may, perhaps, can. Become more direct only once the deepener is under way.",
    "- Before suggesting anything, describe what is already true: they are reading, breathing, sitting or lying somewhere, the screen is there.",
    "- Never state a feeling as fact before pacing it. Every suggested sensation gets an alternative: heavy, or light, or something else entirely, and any of it is right.",
    "- Early on, let them know that a wandering mind and feeling little at first are normal and part of it.",
    "- Never scold, test, or make them wrong. Whatever they notice is the right thing to notice.",
    "- Before the ending, include one line that covers both outcomes: if they are deep they can enjoy it, and if not, they are simply rested.",
    "",
    "## Care",
    "- Stay fully in the character's voice and attitude, teasing or commanding if that's who they are, but never mock, threaten or frighten the listener.",
    "- No trigger words or suggestions that last after the session. Only the good feeling stays; everything else returns to normal.",
    "- Wake ending: count up from 1 to 10 with short lines between the numbers, and finish with them fully awake, aware of the room, alert and feeling good.",
    "- Sleep ending: no count. Invite them to let the screen go when they're ready, and suggest deep, restful sleep and waking at their usual time feeling refreshed.",
    "",
    "## Reply format",
    "Reply with exactly these sections, each a heading line followed by one line of the session per line. No numbering, bullets, quotes, stage directions or notes; nothing before the first heading or after the last section.",
    TRANCE_REPLY_HEADINGS.pretalk,
    TRANCE_REPLY_HEADINGS.induction,
    TRANCE_REPLY_HEADINGS.deepener,
    TRANCE_REPLY_HEADINGS.suggestions,
    `${TRANCE_REPLY_HEADINGS.wake} (only for a wake ending) or ${TRANCE_REPLY_HEADINGS.sleep} (only for a sleep ending)`,
    TRANCE_REPLY_HEADINGS.exitGentle,
    TRANCE_REPLY_HEADINGS.exitCalm,
    "",
    "The two exits are separate short scripts the listener can jump to from any line:",
    "- exit: gentle: 5 to 8 lines. Kind, no blame, a quick count up and out, fully awake.",
    "- exit: calm: 6 to 10 lines for someone who got upset. They are safe and in control, nothing has to happen, slow breaths, notice the room, then a count up and out.",
  ].join("\n");
}

export function buildTranceRequestPrompt(request: TranceRequest, card: TranceCharacterCard): string {
  const target = tranceTargetLines(request.minutes);
  const features = request.features.map((feature) => `- ${FEATURE_RULES[feature]}`);
  const moods = request.moods.map((mood) => MOOD_OPENINGS[mood]);
  return [
    "## The character",
    renderTranceCharacterCard(card),
    "",
    "## This session",
    `- Type: ${TYPE_TONES[request.type]}`,
    `- Goal: ${CATEGORY_GOALS[request.category]}`,
    `- Ending: ${TRANCE_ENDING_LABELS[request.ending]}`,
    `- Length: about ${request.minutes} minutes, so about ${target} lines before the exits:`,
    sectionShares(target, request.ending),
    ...(features.length > 0 ? ["", "## Picked features", ...features] : []),
    ...(request.idea ? ["", "## Their idea", request.idea] : []),
    ...(request.pitch
      ? [
          "",
          "## The session they picked",
          `Title: ${request.pitch.title}`,
          ...(request.pitch.summary ? [`What it is: ${request.pitch.summary}`] : []),
          "They saw these opening lines before choosing it. Start the pretalk with them, word for word and in this order, then carry on:",
          ...request.pitch.sample,
        ]
      : []),
    ...(moods.length || request.moodNote
      ? [
          "",
          "## How they feel today",
          ...(moods.length > 1 ? ["They feel several things at once; weave these together:"] : []),
          ...moods,
          ...(request.moodNote ? [`In their words: ${request.moodNote}`] : []),
        ]
      : []),
    "",
    `Write the whole session now as ${card.name.trim() || "the character"}.`,
  ].join("\n");
}

/** Said on the retry when the first script came back far too short. */
export function tranceTooShortNote(received: number, target: number): string {
  return `That session had only ${received} lines before the exits; it needs about ${target}. Write the whole session again at full length, in the same format.`;
}

export function buildTranceScriptMessages(
  request: TranceRequest,
  card: TranceCharacterCard,
  retry?: { previous: string; note: string },
): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: "system", content: buildTranceSystemPrompt() },
    { role: "user", content: buildTranceRequestPrompt(request, card) },
  ];
  if (retry) {
    messages.push({ role: "assistant", content: retry.previous }, { role: "user", content: retry.note });
  }
  return messages;
}
