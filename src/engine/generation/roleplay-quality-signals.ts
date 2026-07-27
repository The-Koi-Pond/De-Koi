import { boolish, parseRecord, readString } from "./runtime-records";

export type RoleplayQualitySignalKind =
  | "repeated_phrase"
  | "repeated_opening"
  | "repeated_closing"
  | "repeated_gesture"
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

export interface RoleplayQualityMessage {
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
const MAX_GUIDANCE_LINES = 4;
const MAX_EVIDENCE_LENGTH = 240;
const QUESTION_REQUEST_PATTERN = /\b(ask me|questions?|interview me|quiz me|keep asking)\b/i;
const GESTURE_PATTERN =
  /\b(?:tilt(?:ed|s|ing)?|nod(?:ded|s|ding)?|shrug(?:ged|s|ging)?|smirk(?:ed|s|ing)?|sigh(?:ed|s|ing)?|cross(?:ed|es|ing)?|fold(?:ed|s|ing)?|clench(?:ed|es|ing)?|grip(?:ped|s|ping)?)\b/i;
const SECOND_PERSON_DELIBERATE_PATTERN =
  /\byou\s+(?:say|said|ask|asked|reply|replied|agree|agreed|decide|decided|choose|chose|believe|believed|think|thought|want|wanted|intend|intended|promise|promised|cross|crossed|walk|walked|open|opened|take|took|grab|grabbed|grip|gripped|lean|leaned|nod|nodded|shake|shook|sign|signed|accept|accepted|betray|betrayed)\b/gi;
const PERSONA_DELIBERATE_VERB_PATTERN =
  "(?:says?|said|asks?|asked|repl(?:y|ies|ied)|agrees?|agreed|decides?|decided|chooses?|chose|believes?|believed|thinks?|thought|wants?|wanted|intends?|intended|promises?|promised|crosses?|crossed|walks?|walked|opens?|opened|takes?|took|grabs?|grabbed|grips?|gripped|leans?|leaned|nods?|nodded|shakes?|shook|signs?|signed|accepts?|accepted|betrays?|betrayed)";
const LONG_REQUEST_PATTERN = /\b(?:long|longer|full (?:scene|chapter)|scene draft|monologue|detailed)\b/i;
const INTERNAL_OUTPUT_PATTERN = /<\/?(?:analysis|assistant_response|roleplay_quality|roleplay_quality_audit)\b/i;
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

function messageNgrams(message: string): Set<string> {
  const words = normalizeText(message).split(" ").filter(Boolean);
  const grams = new Set<string>();
  for (let size = 5; size >= 3; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      grams.add(words.slice(index, index + size).join(" "));
    }
  }
  return grams;
}

function repeatedNgrams(messages: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const gram of messageNgrams(message)) {
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= 3);
}

function longestRepeatedNgram(entries: Array<[string, number]>): string | null {
  return (
    entries.sort(
      ([left], [right]) => right.split(" ").length - left.split(" ").length || right.length - left.length,
    )[0]?.[0] ?? null
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

export function analyzeRoleplayHistory(input: RoleplayHistoryQualityInput): RoleplayHistoryQualityResult {
  const messages = recentAssistantMessages(input.messages);
  if (messages.length < 3) return { signals: [], guidance: "" };

  const signals: RoleplayQualitySignal[] = [];
  const repeated = repeatedNgrams(messages);
  const phrase = longestRepeatedNgram([...repeated]);
  if (phrase) {
    signals.push(signal("repeated_phrase", phrase, `Avoid repeating the recent phrase "${phrase}" in the next reply.`));
  }
  const gesture = longestRepeatedNgram(repeated.filter(([entry]) => GESTURE_PATTERN.test(entry)));
  if (gesture) {
    signals.push(
      signal("repeated_gesture", gesture, `Use a different physical beat instead of repeating "${gesture}".`),
    );
  }

  const opening = repeatedValue(messages.map(sentenceOpening));
  if (opening) {
    signals.push(
      signal("repeated_opening", opening, `Vary the next sentence opening instead of starting with "${opening}".`),
    );
  }

  const questionCount = messages.filter(endsWithQuestion).length;
  if (questionCount >= 3 && !QUESTION_REQUEST_PATTERN.test(readString(input.latestUserInput))) {
    signals.push(
      signal(
        "repeated_closing",
        `${questionCount} recent replies ended with questions`,
        "Do not end the next reply with another question unless the scene genuinely requires an answer.",
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

function repeatedCandidatePhrase(content: string, recentMessages: string[]): [string, number] | null {
  if (recentMessages.length < 2) return null;
  const candidateNgrams = messageNgrams(content);
  const repeated = repeatedNgrams([...recentMessages, content])
    .filter(([entry, count]) => count >= 3 && candidateNgrams.has(entry))
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || right.split(" ").length - left.split(" ").length || right.length - left.length,
    );
  return repeated[0] ?? null;
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

  const repeated = repeatedCandidatePhrase(content, recentMessages);
  if (repeated) {
    const [phrase, occurrences] = repeated;
    signals.push(
      signal(
        "repeated_phrase",
        phrase,
        `Remove or vary the recurring phrase "${phrase}" only if it is not intentional.`,
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
  if (
    strictAgencyContract(input.agencyContract) &&
    (personaAgencyMatch(content, personaName) ||
      deliberateSecondPersonMatch(content, input.includeQuotedAgencyAssertions))
  ) {
    signals.push(
      signal(
        "agency_candidate",
        content,
        "Audit whether the response assigned dialogue, intent, belief, a decision, or a deliberate action to the user.",
        "high",
      ),
    );
  }
  return { signals, shouldAudit: shouldAuditRoleplaySignals(signals) };
}
