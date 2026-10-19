import { boolish, parseRecord, readString } from "./runtime-records";

export type RoleplayQualitySignalKind =
  | "repeated_phrase"
  | "repeated_opening"
  | "repeated_closing"
  | "repeated_gesture"
  | "negation_beat"
  | "ambient_sound"
  | "user_echo"
  | "rhetorical_repetition"
  | "cast_saturation"
  | "length_mismatch"
  | "malformed_output"
  | "identity_contradiction"
  | "agency_candidate";

export interface RoleplayQualitySignal {
  kind: RoleplayQualitySignalKind;
  severity: "minor" | "high";
  evidence: string[];
  guidance: string;
  occurrences?: number;
}

interface RoleplayQualityMessage {
  role?: unknown;
  content?: unknown;
  extra?: unknown;
  hiddenFromAI?: unknown;
}

export interface RoleplayHistoryQualityInput {
  messages: RoleplayQualityMessage[];
  latestUserInput?: unknown;
}

export interface RoleplayHistoryQualityResult {
  signals: RoleplayQualitySignal[];
  guidance: string;
}

export interface RoleplayResponseQualityInput {
  content: string;
  messages?: RoleplayQualityMessage[];
  latestUserInput?: unknown;
  personaName?: string | null;
  personaDescription?: string | null;
  characterNames?: string[];
  selectedControls?: Record<string, unknown>;
  agencyContract?: string | null;
  includeQuotedAgencyAssertions?: boolean;
}

export interface RoleplayResponseQualityResult {
  signals: RoleplayQualitySignal[];
  shouldAudit: boolean;
}

const RECENT_ASSISTANT_LIMIT = 8;
const MAX_GUIDANCE_LINES = 5;
/** Negation beats are counted over the latest few replies; past about one a reply they read as a tic. */
const NEGATION_WINDOW = 4;
const NEGATION_BEAT_MINIMUM = 5;
/** A noise, body beat, or reused line has to come back in this many of the recent replies. */
const RECURRING_BEAT_MINIMUM = 3;
const COPIED_LINE_WORDS = 6;
const SOUND_CUE_MAX_WORDS = 12;
const NEGATION_BEAT_PATTERN =
  /\b(?:did not|didn't|does not|doesn't|do not|don't|had not|hadn't|has not|hasn't|was not|wasn't|is not|isn't|are not|aren't|could not|couldn't|would not|wouldn't|will not|won't|cannot|can't)\b/i;
/** Grouped by the noise itself: "the heater ticks", "the seals give their small wet tick" and "the frame ticks" are one habit. */
const SOUND_CUE_PATTERN =
  /\b(knock|tick|bang|creak|groan|hum|rattle|hiss|click|drip|buzz|whine|thump|clank|chime|ping|howl|whistle|patter|sputter|clatter|squeal|rumble|thrum|wheeze)(?:s|es|ed|ing|med|ped|ged)?\b/i;
/** A clause led by a person ("He knocks on the door", "Marr knocks") is someone acting, not the room. */
const PERSON_LEAD_PATTERN = /^(?:he|she|they|you|i|we|someone|somebody|nobody|everyone)\b/i;
const SCENE_LEAD_PATTERN =
  /^(?:the|a|an|its|their|his|her|somewhere|outside|overhead|below|above|behind|downstairs|upstairs|then|now|again|still|in|on|at|from|across)\b/i;
const BODY_PART_WORDS =
  "hand|hands|finger|fingers|thumb|thumbs|knuckle|knuckles|knee|knees|jaw|shoulder|shoulders|mouth|eye|eyes|brow|brows|lip|lips|chin|throat|fist|fists|palm|palms|grip|voice|gaze";
const BODY_BEAT_PATTERN = new RegExp(
  `\\b(?:[Hh]is|[Hh]er|[Tt]heir|[A-Z][a-z]+['’]s)\\s+(?:[a-z]+\\s+)?(${BODY_PART_WORDS})\\s+([a-z]+)`,
  "g",
);
const BODY_BEAT_STOPWORDS = new Set(
  "a an the and or but of to in on at by for with from into onto over under against around off up down out as is are was were be has had have that this which who when while than then so if its his her their your my our still".split(
    " ",
  ),
);
const STOCK_PHRASE_PATTERNS = [
  /\b(?:for )?a long moment\b/i,
  /\ba beat\b(?! (?:of|in|on|up))/i,
  /\bsomething (?:shifts|shifted|changes|changed) (?:in|between)\b/i,
  /\bthe ghost of a (?:smile|laugh|grin)\b/i,
  /\ba flicker of\b/i,
  /\b(?:lets|let|letting) out a breath\b/i,
  /\bcouldn't help but\b/i,
  /\bdespite (?:himself|herself|themselves)\b/i,
  /\bin that moment\b/i,
  /\bthe air (?:is |was )?(?:thick|heavy) with\b/i,
];
const MAX_EVIDENCE_LENGTH = 240;
const QUESTION_REQUEST_PATTERN = /\b(ask me|questions?|interview me|quiz me|keep asking)\b/i;
/** The user's inner life written for them. Perception ("you feel the deck tilt") stays allowed. */
const PERSONA_INNER_STATE_PATTERN =
  /\byou\s+(?:know|knew|realize|realized|remember|remembered|wonder|wondered|understand|understood|suspect|suspected|hope|hoped|doubt|doubted)\b|\byou\s+(?:feel|felt)\s+(?:that|like|as if|as though|sure|certain|relieved|guilty|afraid|ashamed|angry|a (?:pang|surge|flush|stab|rush) of)\b|\byou\s+find\s+yourself\b|\bwithout\s+meaning\s+to\b|\bbefore\s+you\s+can\s+stop\s+yourself\b|\bthan\s+you\s+(?:pictured|imagined)\b|\blooks?\s+(?:bad|good|wrong|different)\s+to\s+you\b|\byou\s+don't\s+have\s+to\s+ask\b/gi;
/**
 * A sentence that opens on the user doing something on purpose ("You pick up the dish."), or a beat that waits on
 * an action the user never chose ("keeps it there until you set the dish into it").
 */
const PERSONA_LEADING_ACTION_PATTERN =
  /(?:^|[.!?]["”’)*_]*\s+|\n\s*[*_]*|\buntil\s+)you\s+(pick|picked|get(?!\s+the\s+(?:sense|feeling|impression))|got(?!\s+the\s+(?:sense|feeling|impression))|stand|stood|lay|laid|follow|followed|reach|reached|set|put|pull|pulled|push|pushed|step|stepped|hand|handed|lift|lifted|pocket|pocketed|kneel|knelt|sit|sat|climb|climbed|tell|told|answer|answered|smile|smiled|laugh|laughed)\b/gi;
const SECOND_PERSON_DELIBERATE_PATTERN =
  /\byou\s+(?:say|said|ask|asked|reply|replied|agree|agreed|decide|decided|choose|chose|believe|believed|think|thought|want|wanted|intend|intended|promise|promised|cross|crossed|walk|walked|open|opened|take|took|grab|grabbed|grip|gripped|lean|leaned|nod|nodded|shake|shook|sign|signed|accept|accepted|betray|betrayed)\b/gi;
const PERSONA_DELIBERATE_VERB_PATTERN =
  "(?:says?|said|asks?|asked|repl(?:y|ies|ied)|agrees?|agreed|decides?|decided|chooses?|chose|believes?|believed|thinks?|thought|wants?|wanted|intends?|intended|promises?|promised|crosses?|crossed|walks?|walked|opens?|opened|takes?|took|grabs?|grabbed|grips?|gripped|leans?|leaned|nods?|nodded|shakes?|shook|signs?|signed|accepts?|accepted|betrays?|betrayed)";
const LONG_REQUEST_PATTERN = /\b(?:long|longer|full (?:scene|chapter)|scene draft|monologue|detailed)\b/i;
const INTERNAL_OUTPUT_PATTERN = /<\/?(?:analysis|assistant_response|roleplay_quality|roleplay_quality_audit)\b/i;
const EDITORIAL_DRAFT_PLACEHOLDER_PATTERN =
  /\b(?:CREATIVE\s+BACKGROUND\s+SKIP|BACKGROUND\s+(?:SKIP|TRANSITION)|SCENE\s+(?:CHANGE|SKIP|TRANSITION))\s+HERE\b/;
const MOJIBAKE_PATTERN = /(?:\uFFFD|\u00C3[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{2})/u;
const MIXED_SCRIPT_WORD_PATTERN =
  /(?:\p{Script=Latin}{2,}\p{Script=Han}\p{Script=Latin}+|\p{Script=Latin}{2,}\p{Script=Cyrillic}\p{Script=Latin}+)/u;
const NEGATION_CONTRAST_PATTERN =
  /\bnot\b[^.!?\n]{0,90}\bbut\b|\bnot\b[^.!?\n]{0,60}[.!?]\s*\bnot\b|\bno\b[^.!?\n]{0,60},\s*\bno\b/giu;
const EXPLICIT_LONG_CONTROL_PATTERN =
  /\b(?:length_long|length_scene_draft|scene[- ]draft|above\s+\d+\s+words?|chapter[- ]length)\b/i;
const FLEXIBLE_CONTROL_PATTERN = /\b(?:length_flexible|flexible length)\b/i;
const ONE_LINE_CONTROL_PATTERN = /\b(?:length_one_line|one (?:dialogue )?line|one compact action beat)\b/i;
const SHORT_CONTROL_PATTERN = /\blength_short\b/i;
const MODERATE_CONTROL_PATTERN = /\blength_moderate\b/i;
const CINEMATIC_CONTROL_PATTERN = /\b(?:pacing_cinematic|cinematic pacing)\b/i;

function hidden(message: RoleplayQualityMessage): boolean {
  return boolish(message.hiddenFromAI, false) || boolish(parseRecord(message.extra).hiddenFromAI, false);
}

function normalizeText(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).join(" ");
}

function boundedEvidence(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length <= MAX_EVIDENCE_LENGTH ? compact : `${compact.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`;
}

function recentAssistantMessages(messages: RoleplayQualityMessage[]): string[] {
  return messages
    .filter((message) => readString(message.role).trim() === "assistant")
    .filter((message) => !hidden(message))
    .map((message) => readString(message.content).trim())
    .filter(Boolean)
    .slice(-RECENT_ASSISTANT_LIMIT);
}

function repeatedValue(values: string[], minimum = 3): string | null {
  const counts = new Map<string, number>();
  for (const value of new Set(values.filter(Boolean))) {
    counts.set(value, values.filter((entry) => entry === value).length);
  }
  return (
    [...counts.entries()]
      .filter(([, count]) => count >= minimum)
      .sort(([left], [right]) => right.length - left.length)[0]?.[0] ?? null
  );
}

function sentenceOpening(message: string): string {
  return normalizeText(message.split(/[.!?]/, 1)[0] ?? "")
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

function endsWithQuestion(message: string): boolean {
  return /\?\s*(?:[)\]"'’”.!]*)?$/.test(message.trim());
}

function signal(
  kind: RoleplayQualitySignalKind,
  evidence: string,
  guidance: string,
  severity: RoleplayQualitySignal["severity"] = "minor",
  occurrences?: number,
): RoleplayQualitySignal {
  return {
    kind,
    severity,
    evidence: [boundedEvidence(evidence)],
    guidance,
    ...(occurrences !== undefined ? { occurrences } : {}),
  };
}

/** Narration with quoted dialogue blanked out: "I don't know" in speech is a voice, not a narrator's habit. */
function narrationOf(message: string): string {
  return message.replace(/["“][^"”]{0,1000}["”]/g, " ");
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[\s*_]+|[\s*_]+$/g, "").trim())
    .filter((sentence) => /\p{L}/u.test(sentence));
}

function clipExample(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 90 ? compact : `${compact.slice(0, 89).trimEnd()}…`;
}

function quotedExamples(examples: string[], limit = 2): string {
  return examples
    .slice(0, limit)
    .map((example) => `"${clipExample(example)}"`)
    .join("; ");
}

/** "He doesn't answer." Short sentences about what someone does not do, used as a pause or a reaction. */
function negationBeats(message: string): string[] {
  return sentencesOf(narrationOf(message)).filter(
    (sentence) => NEGATION_BEAT_PATTERN.test(sentence) && wordCount(sentence) <= 10,
  );
}

interface RecurringBeat {
  key: string;
  replies: number;
  /** Newest first. */
  examples: string[];
}

/** Keys that come back in at least `minimum` different replies, most widespread first. */
function recurringBeats(
  messages: string[],
  keysOf: (message: string) => Array<[string, string]>,
  minimum: number,
): RecurringBeat[] {
  const found = new Map<string, RecurringBeat>();
  for (const message of messages) {
    const seen = new Set<string>();
    for (const [key, example] of keysOf(message)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = found.get(key) ?? { key, replies: 0, examples: [] };
      entry.replies += 1;
      entry.examples.unshift(example);
      found.set(key, entry);
    }
  }
  return [...found.values()]
    .filter((entry) => entry.replies >= minimum)
    .sort((left, right) => right.replies - left.replies);
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function verbStem(word: string): string {
  return word.length >= 4 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;
}

const SOUND_ING: Record<string, string> = {
  hum: "humming",
  drip: "dripping",
  thrum: "thrumming",
  whine: "whining",
  wheeze: "wheezing",
  rumble: "rumbling",
  whistle: "whistling",
  rattle: "rattling",
  chime: "chiming",
};

function soundingWord(sound: string): string {
  return SOUND_ING[sound] ?? `${sound}ing`;
}

/** Background noises used as punctuation: "The radiator in the back knocks again." Grouped by what makes the noise. */
function soundCues(message: string): Array<[string, string]> {
  const cues: Array<[string, string]> = [];
  for (const sentence of sentencesOf(narrationOf(message))) {
    // Filler noises are short sentences ("The heater ticks under the floor."); a long one is usually the plot.
    if (wordCount(sentence) > SOUND_CUE_MAX_WORDS) continue;
    for (const clause of sentence.split(/[,;:]\s+|\s+(?:and|while|as)\s+/)) {
      const sound = clause.match(SOUND_CUE_PATTERN);
      if (!sound || sound.index === undefined) continue;
      const before = clause.slice(0, sound.index).trimStart();
      if (PERSON_LEAD_PATTERN.test(before)) continue;
      if (/^[A-Z]/.test(before) && !SCENE_LEAD_PATTERN.test(before)) continue;
      cues.push([sound[1]!.toLowerCase(), sentence]);
    }
  }
  return cues;
}

/** A character's go-to body beat: "his fingers dig into your shoulder", "Sal's knees crack". */
function bodyBeats(message: string): Array<[string, string]> {
  const beats: Array<[string, string]> = [];
  for (const sentence of sentencesOf(narrationOf(message))) {
    for (const match of sentence.matchAll(BODY_BEAT_PATTERN)) {
      const next = match[2]!.toLowerCase();
      if (BODY_BEAT_STOPWORDS.has(next)) continue;
      beats.push([`${singular(match[1]!.toLowerCase())} ${verbStem(next)}`, sentence]);
    }
  }
  return beats;
}

function stockPhrases(message: string): Array<[string, string]> {
  const hits: Array<[string, string]> = [];
  for (const sentence of sentencesOf(message)) {
    for (const pattern of STOCK_PHRASE_PATTERNS) {
      const match = sentence.match(pattern);
      if (match) hits.push([match[0].toLowerCase(), sentence]);
    }
  }
  return hits;
}

function copiedLines(message: string): Array<[string, string]> {
  const words = normalizeText(message).split(" ").filter(Boolean);
  const grams: Array<[string, string]> = [];
  for (let index = 0; index + COPIED_LINE_WORDS <= words.length; index += 1) {
    const gram = words.slice(index, index + COPIED_LINE_WORDS).join(" ");
    grams.push([gram, gram]);
  }
  return grams;
}

function overlapsByShift(left: string[], right: string[]): boolean {
  for (let shift = 1; shift < left.length; shift += 1) {
    if (left.slice(shift).join(" ") === right.slice(0, -shift).join(" ")) return true;
  }
  return false;
}

/** One copied line shows up as many overlapping six-word windows; keep one window per line. */
function distinctCopiedLines(entries: RecurringBeat[]): RecurringBeat[] {
  const kept: RecurringBeat[] = [];
  for (const entry of entries) {
    const words = entry.key.split(" ");
    const overlaps = kept.some((other) => {
      const otherWords = other.key.split(" ");
      return overlapsByShift(words, otherWords) || overlapsByShift(otherWords, words);
    });
    if (!overlaps) kept.push(entry);
  }
  return kept;
}

/**
 * Habits the recent replies keep falling back on, as steering for the next reply: negation beats, background noises
 * used as pauses, a go-to body beat, the same opening, stock phrases, whole lines reused, question endings. It never
 * flags the scene's own nouns ("the generator room"), which a story is supposed to repeat.
 */
export function analyzeRoleplayHistory(input: RoleplayHistoryQualityInput): RoleplayHistoryQualityResult {
  const messages = recentAssistantMessages(input.messages);
  if (messages.length < 3) return { signals: [], guidance: "" };

  const signals: RoleplayQualitySignal[] = [];
  const latest = messages.slice(-NEGATION_WINDOW);
  const negations = latest.flatMap(negationBeats);
  if (negations.length >= NEGATION_BEAT_MINIMUM) {
    signals.push(
      signal(
        "negation_beat",
        negations.slice(-3).join(" | "),
        `- Short "X doesn't Y" beats: ${negations.length} in the last ${latest.length} replies (${quotedExamples(negations.slice(-2).reverse())}). Show what people do or say instead. At most one in this reply.`,
        "minor",
        negations.length,
      ),
    );
  }

  for (const sound of recurringBeats(messages, soundCues, RECURRING_BEAT_MINIMUM).slice(0, 2)) {
    signals.push(
      signal(
        "ambient_sound",
        sound.examples[0]!,
        `- Something ${soundingWord(sound.key)} in the background fills a pause in ${sound.replies} of the last ${messages.length} replies (${quotedExamples(sound.examples, 1)}). Leave that noise out of this reply, and don't swap in another one.`,
        "minor",
        sound.replies,
      ),
    );
  }

  const body = recurringBeats(messages, bodyBeats, RECURRING_BEAT_MINIMUM)[0];
  if (body) {
    signals.push(
      signal(
        "repeated_gesture",
        body.examples[0]!,
        `- The same body beat keeps coming back, in ${body.replies} recent replies (${quotedExamples(body.examples)}). Use a different reaction, or none.`,
        "minor",
        body.replies,
      ),
    );
  }

  const opening = repeatedValue(messages.map(sentenceOpening));
  // "Sal doesn't nod." / "Sal doesn't laugh this time." differ word by word but are the same move.
  const negationOpeners = messages
    .map((message) => sentencesOf(narrationOf(message))[0] ?? "")
    .filter((sentence) => NEGATION_BEAT_PATTERN.test(sentence) && wordCount(sentence) <= 10);
  if (negationOpeners.length >= RECURRING_BEAT_MINIMUM) {
    signals.push(
      signal(
        "repeated_opening",
        negationOpeners.slice(-2).join(" | "),
        `- ${negationOpeners.length} of the last ${messages.length} replies open on what someone doesn't do (${quotedExamples(negationOpeners.slice(-2).reverse())}). Open this one on something that happens.`,
        "minor",
        negationOpeners.length,
      ),
    );
  } else if (opening) {
    signals.push(
      signal(
        "repeated_opening",
        opening,
        `- Several recent replies open with "${opening}". Open this one differently.`,
      ),
    );
  }

  const stock = recurringBeats(messages, stockPhrases, 2)[0];
  if (stock) {
    signals.push(
      signal(
        "repeated_phrase",
        stock.key,
        `- The stock phrase "${stock.key}" is in ${stock.replies} recent replies. Don't use it again.`,
        "minor",
        stock.replies,
      ),
    );
  }

  const copied = distinctCopiedLines(recurringBeats(messages, copiedLines, RECURRING_BEAT_MINIMUM))[0];
  if (copied) {
    signals.push(
      signal(
        "repeated_phrase",
        copied.key,
        `- "${copied.key}" is reused word for word in ${copied.replies} recent replies. Don't reuse it.`,
        "minor",
        copied.replies,
      ),
    );
  }

  const questionCount = messages.filter(endsWithQuestion).length;
  if (questionCount >= 3 && !QUESTION_REQUEST_PATTERN.test(readString(input.latestUserInput))) {
    signals.push(
      signal(
        "repeated_closing",
        `${questionCount} recent replies ended with questions`,
        "- Don't end this reply with another question unless the scene needs an answer.",
      ),
    );
  }

  const guidance = Array.from(new Set(signals.map((entry) => entry.guidance)))
    .slice(0, MAX_GUIDANCE_LINES)
    .join("\n");
  return { signals, guidance };
}

function strictAgencyContract(value: unknown): boolean {
  const normalized = readString(value).trim().toLowerCase();
  return normalized === "agency_strict" || normalized.startsWith("strict agency:");
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskNonAssertedSecondPersonClauses(content: string, includeQuotedAgencyAssertions = false): string {
  const withoutIgnoredDialogue = includeQuotedAgencyAssertions
    ? content
    : content.replace(/(["“])[^"”]{0,1000}(["”])/g, (value) => " ".repeat(value.length));
  return withoutIgnoredDialogue
    .replace(/(?:^|[.!?]\s+|\n+)[^.!?\n]{0,300}\?/g, (value) => " ".repeat(value.length))
    .replace(/\b(?:if|whether|unless|when|before)\b[^.!?\n]{0,240}?(?=,|[.!?\n]|$)/gi, (value) =>
      " ".repeat(value.length),
    );
}

function deliberateSecondPersonMatch(content: string, includeQuotedAgencyAssertions = false): RegExpExecArray | null {
  const assertedContent = maskNonAssertedSecondPersonClauses(content, includeQuotedAgencyAssertions);
  SECOND_PERSON_DELIBERATE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECOND_PERSON_DELIBERATE_PATTERN.exec(assertedContent)) !== null) {
    const prefix = assertedContent.slice(Math.max(0, match.index - 12), match.index);
    if (!/\bafter\s*$/i.test(prefix)) return match;
  }
  return null;
}

function personaAgencyMatch(content: string, personaName: string): boolean {
  if (!personaName.trim()) return false;
  const name = escapedPattern(personaName.trim());
  const direct = new RegExp(`\\b${name}\\s+${PERSONA_DELIBERATE_VERB_PATTERN}\\b`, "i");
  const attributedDialogue = new RegExp(
    `(?:["“][^"”]{1,240}["”]\\s*,?\\s*)${name}\\s+${PERSONA_DELIBERATE_VERB_PATTERN}\\b`,
    "i",
  );
  const speakerLabeledDialogue = new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*\\S`, "i");
  return direct.test(content) || attributedDialogue.test(content) || speakerLabeledDialogue.test(content);
}

function wordCount(value: string): number {
  return value.match(/[\p{L}\p{N}']+/gu)?.length ?? 0;
}

function selectedControlText(controls: Record<string, unknown> | undefined): string {
  if (!controls) return "";
  return Object.entries(controls)
    .flatMap(([key, value]) => [key, readString(value)])
    .join(" ")
    .toLowerCase();
}

function latestUserEcho(content: string, latestUserInput: unknown): string | null {
  const userWords = normalizeText(readString(latestUserInput)).split(" ").filter(Boolean);
  if (userWords.length < 6) return null;
  const normalizedContent = ` ${normalizeText(content)} `;
  for (let size = Math.min(14, userWords.length); size >= 6; size -= 1) {
    for (let index = 0; index <= userWords.length - size; index += 1) {
      const phrase = userWords.slice(index, index + size).join(" ");
      if (normalizedContent.includes(` ${phrase} `)) return phrase;
    }
  }
  return null;
}

/**
 * A line of six or more words this reply copies from at least two recent replies. Shorter overlaps are left to the
 * next-turn habit note: in real chats they are mostly the scene's own nouns, and "fixing" them only swapped words.
 */
function copiedCandidateLine(content: string, recentMessages: string[]): [string, number] | null {
  if (recentMessages.length < 2) return null;
  const candidate = new Set(copiedLines(content).map(([gram]) => gram));
  const counts = new Map<string, number>();
  for (const message of recentMessages) {
    for (const gram of new Set(copiedLines(message).map(([entry]) => entry))) {
      if (candidate.has(gram)) counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].filter(([, count]) => count >= 2).sort((left, right) => right[1] - left[1])[0];
  return best ? [best[0], best[1] + 1] : null;
}

function sentenceAt(content: string, index: number): string {
  const before = content.slice(0, index);
  // The sentence starts after the last stop (closing quotes included) or line break before the match.
  let start = 0;
  for (const stop of before.matchAll(/[.!?…]["”’)*_]*\s+|\n+/g)) start = stop.index + stop[0].length;
  const after = content.slice(index).search(/[.!?\n]/);
  return content
    .slice(start, after < 0 ? content.length : index + after + 1)
    .replace(/^[\s*_]+|[\s*_]+$/g, "")
    .trim();
}

/**
 * Narration that writes the user's inner life ("You know a barometer can stick.", "smaller than you pictured") or opens
 * a sentence on a deliberate action ("You pick up the dish."). Strict agency leaves both to the user. Returns the
 * sentences, so the editor sees the spans instead of the whole reply.
 */
function personaInnerOrLeadingActionSentences(
  content: string,
  latestUserInput: unknown,
  includeQuotedAgencyAssertions = false,
): string[] {
  const asserted = maskNonAssertedSecondPersonClauses(content, includeQuotedAgencyAssertions);
  const userWords = new Set(normalizeText(readString(latestUserInput)).split(" "));
  const sentences: string[] = [];
  for (const match of asserted.matchAll(PERSONA_INNER_STATE_PATTERN)) {
    sentences.push(sentenceAt(content, match.index));
  }
  for (const match of asserted.matchAll(PERSONA_LEADING_ACTION_PATTERN)) {
    // Restating what the user just said they did ("I pick up the dish" -> "You pick up the dish") is a consequence.
    if (userWords.has(match[1]!.toLowerCase())) continue;
    sentences.push(sentenceAt(content, match.index + match[0].length - match[1]!.length));
  }
  return [...new Set(sentences.filter(Boolean))];
}

function rhetoricalRepetitionEvidence(content: string): { evidence: string; occurrences: number } | null {
  const contrastMatches = content.match(NEGATION_CONTRAST_PATTERN) ?? [];
  if (contrastMatches.length >= 3) {
    return { evidence: contrastMatches.slice(0, 3).join(" | "), occurrences: contrastMatches.length };
  }
  const dashCount = content.match(/—/g)?.length ?? 0;
  const shortSentenceCount = content
    .split(/[.!?]+/)
    .map((entry) => entry.trim().replace(/^[-—*_]+/, ""))
    .filter((entry) => entry && wordCount(entry) <= 5).length;
  if (dashCount >= 4 && shortSentenceCount >= 3) {
    return {
      evidence: `${dashCount} em-dash beats and ${shortSentenceCount} short sentence beats`,
      occurrences: Math.min(dashCount, shortSentenceCount),
    };
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function exceedsSelectedLength(
  content: string,
  latestUserInput: unknown,
  recentMessages: string[],
  controls: Record<string, unknown> | undefined,
): boolean {
  const words = wordCount(content);
  const controlText = selectedControlText(controls);
  const latestUserText = readString(latestUserInput);
  if (EXPLICIT_LONG_CONTROL_PATTERN.test(controlText) || LONG_REQUEST_PATTERN.test(latestUserText)) return false;

  if (ONE_LINE_CONTROL_PATTERN.test(controlText)) {
    const sentenceCount = content.split(/[.!?]+/).filter((entry) => entry.trim()).length;
    return words > 80 || sentenceCount > 3;
  }

  const underMatch = controlText.match(/\bunder\s+(\d+)\s+words?\b/i);
  if (underMatch) return words > Math.ceil(Number(underMatch[1]) * 1.25);
  const rangeMatch = controlText.match(/\b(\d+)\s+to\s+(\d+)\s+words?\b/i);
  if (rangeMatch) return words > Math.ceil(Number(rangeMatch[2]) * 1.25);
  if (SHORT_CONTROL_PATTERN.test(controlText)) return words > 188;
  if (MODERATE_CONTROL_PATTERN.test(controlText)) return words > 375;

  const userWords = Math.max(1, wordCount(latestUserText));
  const recentMedian = median(
    recentMessages
      .slice(-3)
      .map(wordCount)
      .filter((count) => count > 0),
  );
  if (FLEXIBLE_CONTROL_PATTERN.test(controlText)) {
    return words > 650 && words > userWords * 6 && (recentMedian === null || words > recentMedian * 2.5);
  }
  return words > 900 && words > userWords * 8 && (recentMedian === null || words > recentMedian * 2.5);
}

function castSaturationEvidence(
  content: string,
  latestUserInput: unknown,
  characterNames: string[],
  controls: Record<string, unknown> | undefined,
): string | null {
  const names = Array.from(new Set(characterNames.map((name) => name.trim()).filter(Boolean)));
  if (names.length < 4 || wordCount(content) <= 700) return null;
  const controlText = selectedControlText(controls);
  if (EXPLICIT_LONG_CONTROL_PATTERN.test(controlText) || CINEMATIC_CONTROL_PATTERN.test(controlText)) return null;
  const namedInReply = names.filter((name) => new RegExp(`\\b${escapedPattern(name)}\\b`, "iu").test(content));
  if (namedInReply.length !== names.length) return null;
  const userText = readString(latestUserInput);
  if (names.some((name) => new RegExp(`\\b${escapedPattern(name)}\\b`, "iu").test(userText))) return null;
  return `Reply names all ${names.length} active characters despite a narrow user turn`;
}

type PronounFamily = "he" | "she" | "they";

function authoritativePronounFamily(description: string): PronounFamily | null {
  const match = description.match(
    /\b(?:pronouns?\s*[:=-]\s*|uses?\s+)(he\s*\/\s*him|she\s*\/\s*her|they\s*\/\s*them)(?:\s+pronouns?)?/i,
  );
  if (!match) return null;
  const normalized = match[1]!.toLowerCase().replace(/\s+/g, "");
  if (normalized === "he/him") return "he";
  if (normalized === "she/her") return "she";
  return "they";
}

function identityContradictionEvidence(
  content: string,
  personaName: string,
  personaDescription: string,
): string | null {
  const family = authoritativePronounFamily(personaDescription);
  if (!family || !personaName.trim()) return null;
  const conflict =
    family === "they"
      ? /\b(?:he|him|his|himself|she|her|hers|herself)\b/i
      : family === "she"
        ? /\b(?:he|him|his|himself|they|them|their|theirs|themself|themselves)\b/i
        : /\b(?:she|her|hers|herself|they|them|their|theirs|themself|themselves)\b/i;
  const name = new RegExp(`\\b${escapedPattern(personaName.trim())}\\b`, "iu");
  for (const sentence of content.split(/(?<=[.!?])\s+|\n+/)) {
    if (name.test(sentence) && conflict.test(sentence)) return sentence;
  }
  return null;
}

function malformedEvidence(content: string): string | null {
  if (EDITORIAL_DRAFT_PLACEHOLDER_PATTERN.test(content)) {
    return content.match(EDITORIAL_DRAFT_PLACEHOLDER_PATTERN)?.[0] ?? content;
  }
  if (INTERNAL_OUTPUT_PATTERN.test(content)) return content.match(INTERNAL_OUTPUT_PATTERN)?.[0] ?? content;
  if (MOJIBAKE_PATTERN.test(content)) return content.match(MOJIBAKE_PATTERN)?.[0] ?? content;
  if (
    [...content].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    })
  ) {
    return "Unexpected control character in generated prose";
  }
  if (MIXED_SCRIPT_WORD_PATTERN.test(content)) return content.match(MIXED_SCRIPT_WORD_PATTERN)?.[0] ?? content;
  return null;
}

function shouldAuditRoleplaySignals(signals: RoleplayQualitySignal[]): boolean {
  if (signals.some((entry) => entry.severity === "high")) return true;
  if (new Set(signals.map((entry) => entry.kind)).size >= 2) return true;
  return signals.some((entry) => (entry.occurrences ?? 0) >= 3);
}

export function analyzeRoleplayResponse(input: RoleplayResponseQualityInput): RoleplayResponseQualityResult {
  const content = input.content.trim();
  if (!content) return { signals: [], shouldAudit: false };
  const signals: RoleplayQualitySignal[] = [];
  const recentMessages = recentAssistantMessages(input.messages ?? []).slice(-6);

  const malformed = malformedEvidence(content);
  if (malformed) {
    signals.push(
      signal(
        "malformed_output",
        malformed,
        "Audit the malformed or corrupted span without changing unrelated prose.",
        "high",
      ),
    );
  }

  const identityConflict = identityContradictionEvidence(
    content,
    input.personaName?.trim() ?? "",
    input.personaDescription?.trim() ?? "",
  );
  if (identityConflict) {
    signals.push(
      signal(
        "identity_contradiction",
        identityConflict,
        "Audit the explicit persona identity contradiction against authoritative pronouns.",
        "high",
      ),
    );
  }

  const echo = latestUserEcho(content, input.latestUserInput);
  if (echo) {
    signals.push(
      signal("user_echo", echo, "Avoid restating the user's wording unless the scene requires a direct quotation."),
    );
  }

  const copied = copiedCandidateLine(content, recentMessages);
  if (copied) {
    const [phrase, occurrences] = copied;
    signals.push(
      signal(
        "repeated_phrase",
        phrase,
        `This reply reuses "${phrase}" word for word from earlier replies. Cut that line unless the scene needs it.`,
        "minor",
        occurrences,
      ),
    );
  }

  const rhetoric = rhetoricalRepetitionEvidence(content);
  if (rhetoric) {
    signals.push(
      signal(
        "rhetorical_repetition",
        rhetoric.evidence,
        "Audit whether repeated rhetorical cadence is restating one beat instead of advancing it.",
        "minor",
        rhetoric.occurrences,
      ),
    );
  }

  if (exceedsSelectedLength(content, input.latestUserInput, recentMessages, input.selectedControls)) {
    signals.push(
      signal(
        "length_mismatch",
        `${wordCount(content)} words for the selected response-length context`,
        "Audit whether the reply substantially exceeds its selected interactive length without adding usable state.",
      ),
    );
  }

  const castEvidence = castSaturationEvidence(
    content,
    input.latestUserInput,
    input.characterNames ?? [],
    input.selectedControls,
  );
  if (castEvidence) {
    signals.push(
      signal(
        "cast_saturation",
        castEvidence,
        "Audit whether every active character received a decorative reaction instead of a necessary scene beat.",
      ),
    );
  }

  const personaName = input.personaName?.trim() ?? "";
  if (strictAgencyContract(input.agencyContract)) {
    const innerOrAction = personaInnerOrLeadingActionSentences(
      content,
      input.latestUserInput,
      input.includeQuotedAgencyAssertions,
    );
    if (
      personaAgencyMatch(content, personaName) ||
      deliberateSecondPersonMatch(content, input.includeQuotedAgencyAssertions)
    ) {
      signals.push(
        signal(
          "agency_candidate",
          content,
          "Audit whether the response assigned dialogue, intent, belief, a decision, or a deliberate action to the user.",
          "high",
        ),
      );
    } else if (innerOrAction.length > 0) {
      signals.push({
        kind: "agency_candidate",
        severity: "high",
        evidence: innerOrAction.slice(0, 3).map(boundedEvidence),
        guidance:
          "Audit whether these sentences state the user's thoughts, feelings, knowledge, or conclusions, or have the user take a deliberate action. Under strict agency, delete the sentence or the clause that does.",
      });
    }
  }
  return { signals, shouldAudit: shouldAuditRoleplaySignals(signals) };
}
