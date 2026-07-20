import { boolish, parseRecord, readString } from "./runtime-records";

export type RoleplayQualitySignalKind =
  | "repeated_phrase"
  | "repeated_opening"
  | "repeated_closing"
  | "repeated_gesture"
  | "agency_candidate";

export interface RoleplayQualitySignal {
  kind: RoleplayQualitySignalKind;
  severity: "minor" | "high";
  evidence: string[];
  guidance: string;
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
  personaName?: string | null;
  characterNames?: string[];
  agencyContract?: string | null;
  includeQuotedAgencyAssertions?: boolean;
}

export interface RoleplayResponseQualityResult {
  signals: RoleplayQualitySignal[];
}

const RECENT_ASSISTANT_LIMIT = 8;
const MAX_GUIDANCE_LINES = 4;
const MAX_EVIDENCE_LENGTH = 240;
const QUESTION_REQUEST_PATTERN = /\b(ask me|questions?|interview me|quiz me|keep asking)\b/i;
const GESTURE_PATTERN =
  /\b(?:tilt(?:ed|s|ing)?|nod(?:ded|s|ding)?|shrug(?:ged|s|ging)?|smirk(?:ed|s|ing)?|sigh(?:ed|s|ing)?|cross(?:ed|es|ing)?|fold(?:ed|s|ing)?|clench(?:ed|es|ing)?|grip(?:ped|s|ping)?)\b/i;
const SECOND_PERSON_DELIBERATE_PATTERN =
  /\byou\s+(?:say|said|ask|asked|reply|replied|agree|agreed|decide|decided|choose|chose|believe|believed|think|thought|want|wanted|intend|intended|promise|promised|cross|crossed|walk|walked|open|opened|take|took|grab|grabbed|nod|nodded|shake|shook|sign|signed|accept|accepted|betray|betrayed)\b/gi;
const PERSONA_DELIBERATE_VERB_PATTERN =
  "(?:says?|said|asks?|asked|repl(?:y|ies|ied)|agrees?|agreed|decides?|decided|chooses?|chose|believes?|believed|thinks?|thought|wants?|wanted|intends?|intended|promises?|promised|crosses?|crossed|walks?|walked|opens?|opened|takes?|took|grabs?|grabbed|nods?|nodded|shakes?|shook|signs?|signed|accepts?|accepted|betrays?|betrayed)";

function hidden(message: RoleplayQualityMessage): boolean {
  return (
    boolish(message.hiddenFromAI, false) ||
    boolish(parseRecord(message.extra).hiddenFromAI, false)
  );
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
  return [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .sort(([left], [right]) => right.length - left.length)[0]?.[0] ?? null;
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
): RoleplayQualitySignal {
  return { kind, severity, evidence: [boundedEvidence(evidence)], guidance };
}

export function analyzeRoleplayHistory(input: RoleplayHistoryQualityInput): RoleplayHistoryQualityResult {
  const messages = recentAssistantMessages(input.messages);
  if (messages.length < 3) return { signals: [], guidance: "" };

  const signals: RoleplayQualitySignal[] = [];
  const repeated = repeatedNgrams(messages);
  const phrase = longestRepeatedNgram([...repeated]);
  if (phrase) {
    signals.push(
      signal(
        "repeated_phrase",
        phrase,
        `Avoid repeating the recent phrase "${phrase}" in the next reply.`,
      ),
    );
  }
  const gesture = longestRepeatedNgram(repeated.filter(([entry]) => GESTURE_PATTERN.test(entry)));
  if (gesture) {
    signals.push(
      signal(
        "repeated_gesture",
        gesture,
        `Use a different physical beat instead of repeating "${gesture}".`,
      ),
    );
  }

  const opening = repeatedValue(messages.map(sentenceOpening));
  if (opening) {
    signals.push(
      signal(
        "repeated_opening",
        opening,
        `Vary the next sentence opening instead of starting with "${opening}".`,
      ),
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
    .replace(
      /(?:^|[.!?]\s+|\n+)[^.!?\n]{0,300}\?/g,
      (value) => " ".repeat(value.length),
    )
    .replace(
      /\b(?:if|whether|unless|when|before)\b[^.!?\n]{0,240}?(?=,|[.!?\n]|$)/gi,
      (value) => " ".repeat(value.length),
    );
}

function deliberateSecondPersonMatch(
  content: string,
  includeQuotedAgencyAssertions = false,
): RegExpExecArray | null {
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

export function analyzeRoleplayResponse(input: RoleplayResponseQualityInput): RoleplayResponseQualityResult {
  const content = input.content.trim();
  if (!content || !strictAgencyContract(input.agencyContract)) return { signals: [] };
  const personaName = input.personaName?.trim() ?? "";
  if (
    !personaAgencyMatch(content, personaName) &&
    !deliberateSecondPersonMatch(content, input.includeQuotedAgencyAssertions)
  ) {
    return { signals: [] };
  }
  return {
    signals: [
      signal(
        "agency_candidate",
        content,
        "Audit whether the response assigned dialogue, intent, belief, a decision, or a deliberate action to the user.",
        "high",
      ),
    ],
  };
}
