import type {
  BehavioralClaimEvidence,
  BehavioralEvidenceClass,
  BehavioralEvidenceField,
  CharacterBehavioralClaim,
  CharacterBehavioralInterpretation,
  CharacterData,
} from "../contracts/types/character";
import { buildBehavioralExamplePool } from "./behavioral-example-pool";

export const BEHAVIORAL_INTERPRETATION_VERSION = 1 as const;

type AuthoredEvidenceField = Exclude<BehavioralEvidenceField, "user_override">;

export interface CharacterRichnessAssessment {
  sparse: boolean;
  score: number;
  authoredWordCount: number;
  populatedBehaviorFields: number;
  reasons: string[];
}

const EVIDENCE_CLASSES = new Set<BehavioralEvidenceClass>(["explicit", "strongly_implied", "tentative"]);
const AUTHORED_FIELDS: AuthoredEvidenceField[] = [
  "description",
  "personality",
  "scenario",
  "backstory",
  "first_mes",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
  "character_book",
];
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "her",
  "his",
  "in",
  "is",
  "it",
  "may",
  "of",
  "on",
  "or",
  "she",
  "he",
  "the",
  "their",
  "to",
  "uses",
  "when",
  "with",
]);
const SEMANTIC_TOKEN_ALIASES: Record<string, string> = {
  answer: "answer",
  answered: "answer",
  answering: "answer",
  answers: "answer",
  avoid: "deflect",
  avoids: "deflect",
  blunt: "direct",
  bluntly: "direct",
  deflect: "deflect",
  deflection: "deflect",
  deflects: "deflect",
  dodge: "deflect",
  dodges: "deflect",
  dry: "humor",
  evade: "deflect",
  evasive: "deflect",
  humor: "humor",
  humour: "humor",
  inquiries: "question",
  inquiry: "question",
  intimate: "personal",
  joke: "humor",
  jokes: "humor",
  plain: "direct",
  plainly: "direct",
  private: "personal",
  question: "question",
  questions: "question",
  redirect: "deflect",
  redirects: "deflect",
  sarcastic: "humor",
  sarcasm: "humor",
  sidestep: "deflect",
  sidesteps: "deflect",
  use: "use",
  uses: "use",
  wit: "humor",
  witty: "humor",
};
const USER_CONTROL_PATTERN =
  /\b(?:make|force|require|have)\s+(?:the\s+)?user\b|\b(?:the\s+)?user\s+(?:must|will|says?|decides?|believes?|agrees?|confesses?)\b|\byou\s+(?:must|will|say|decide|agree|confess)\b/iu;
const BIOGRAPHY_PATTERN =
  /\b(?:born|childhood|family|parents?|siblings?|grew up|raised by|abandoned|married|spouse|children|daughter|son|royalty|princess|prince|used to|worked as|served as)\b/iu;

function clean(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim()
    : "";
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return Array.from(normalize(value).matchAll(/[\p{Letter}\p{Number}]{2,}/gu), (match) => match[0]);
}

function meaningfulWords(value: string): Set<string> {
  return new Set(words(value).filter((token) => !STOPWORDS.has(token)));
}

function semanticWords(value: string): Set<string> {
  return new Set(
    words(value)
      .filter((token) => !STOPWORDS.has(token))
      .map((token) => SEMANTIC_TOKEN_ALIASES[token] ?? token),
  );
}

function containmentScore(left: Set<string>, right: Set<string>): number {
  const smallerSize = Math.min(left.size, right.size);
  if (smallerSize === 0) return 0;
  return overlapCount(left, right) / smallerSize;
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function evidenceEquivalent(
  left: BehavioralClaimEvidence[] | null | undefined,
  right: BehavioralClaimEvidence[] | null | undefined,
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.some((leftEvidence) =>
    right.some((rightEvidence) => {
      if (leftEvidence.field !== rightEvidence.field) return false;
      const leftQuote = normalize(leftEvidence.quote);
      const rightQuote = normalize(rightEvidence.quote);
      if (!leftQuote || !rightQuote) return false;
      if (leftQuote === rightQuote || leftQuote.includes(rightQuote) || rightQuote.includes(leftQuote)) return true;
      return containmentScore(meaningfulWords(leftQuote), meaningfulWords(rightQuote)) >= 0.8;
    }),
  );
}

function claimsEquivalent(left: CharacterBehavioralClaim, right: CharacterBehavioralClaim): boolean {
  const leftStatement = normalize(left.statement);
  const rightStatement = normalize(right.statement);
  if (!leftStatement || !rightStatement) return false;
  if (leftStatement === rightStatement) return true;
  const surfaceOverlap = containmentScore(meaningfulWords(leftStatement), meaningfulWords(rightStatement));
  if (surfaceOverlap >= 0.8) return true;
  const leftSemanticWords = semanticWords(leftStatement);
  const rightSemanticWords = semanticWords(rightStatement);
  const semanticOverlap = containmentScore(leftSemanticWords, rightSemanticWords);
  const sharedSemanticWords = overlapCount(leftSemanticWords, rightSemanticWords);
  // Shared evidence can strengthen statement similarity, but never establishes equivalence by itself.
  return (
    semanticOverlap >= 0.72 ||
    (sharedSemanticWords >= 2 && semanticOverlap >= 0.4 && evidenceEquivalent(left.evidence, right.evidence))
  );
}

function uniqueClaims(claims: CharacterBehavioralClaim[]): CharacterBehavioralClaim[] {
  return claims.filter(
    (claim, index) => claims.findIndex((candidate) => claimsEquivalent(candidate, claim)) === index,
  );
}

function repeatsAuthoredText(authored: string, claim: CharacterBehavioralClaim): boolean {
  const statement = normalize(claim.statement);
  return !statement || authored.includes(statement) || statement.includes(authored);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function boundedLore(data: CharacterData): string {
  return (data.character_book?.entries ?? [])
    .filter((entry) => entry.enabled !== false)
    .sort((left, right) => right.priority - left.priority || left.insertion_order - right.insertion_order)
    .slice(0, 4)
    .map((entry) => clean(entry.content).slice(0, 800))
    .filter(Boolean)
    .join("\n");
}

function authoredDialogueSources(data: CharacterData): { firstMes: string; mesExample: string } {
  const examples = buildBehavioralExamplePool([
    {
      id: "behavioral-interpretation-source",
      name: clean(data.name) || "Character",
      firstMes: data.first_mes,
      mesExample: data.mes_example,
    },
  ]);
  return {
    firstMes: examples
      .filter((example) => example.sourceField === "first_mes")
      .map((example) => example.dialogueText)
      .join("\n\n"),
    mesExample: examples
      .filter((example) => example.sourceField === "mes_example")
      .map((example) => example.dialogueText)
      .join("\n\n"),
  };
}

export function behavioralInterpretationSources(data: CharacterData): Record<AuthoredEvidenceField, string> {
  const dialogue = authoredDialogueSources(data);
  return {
    description: clean(data.description),
    personality: clean(data.personality),
    scenario: clean(data.scenario),
    backstory: clean(data.extensions?.backstory),
    first_mes: dialogue.firstMes,
    mes_example: dialogue.mesExample,
    system_prompt: clean(data.system_prompt),
    post_history_instructions: clean(data.post_history_instructions),
    character_book: boundedLore(data),
  };
}

export function behavioralInterpretationSourceHash(data: CharacterData): string {
  const sources = behavioralInterpretationSources(data);
  const stable = [
    `name:${normalize(clean(data.name))}`,
    ...AUTHORED_FIELDS.map((field) => `${field}:${normalize(sources[field])}`),
  ].join("\n");
  return stableHash(stable);
}

export function assessCharacterRichness(data: CharacterData): CharacterRichnessAssessment {
  const sources = behavioralInterpretationSources(data);
  const behaviorFields: AuthoredEvidenceField[] = [
    "description",
    "personality",
    "scenario",
    "backstory",
    "first_mes",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
  ];
  const populatedBehaviorFields = behaviorFields.filter((field) => words(sources[field]).length >= 6).length;
  const authoredWordCount = Object.values(sources).reduce((sum, value) => sum + words(value).length, 0);
  const dialogueBonus = Math.min(16, words(sources.mes_example).length / 5 + words(sources.first_mes).length / 8);
  const score = Math.round(
    Math.min(100, populatedBehaviorFields * 9 + Math.min(48, authoredWordCount / 3) + dialogueBonus),
  );
  const reasons: string[] = [];
  if (populatedBehaviorFields < 4) reasons.push("few_authored_behavior_fields");
  if (authoredWordCount < 120) reasons.push("low_authored_word_count");
  return {
    sparse: score < 60,
    score,
    authoredWordCount,
    populatedBehaviorFields,
    reasons,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function evidenceSupported(sources: Record<AuthoredEvidenceField, string>, evidence: BehavioralClaimEvidence): boolean {
  if (evidence.field === "user_override") return evidence.quote === "User correction";
  const source = normalize(sources[evidence.field]);
  const quote = normalize(evidence.quote);
  return quote.length >= 6 && source.includes(quote);
}

function claimSupported(statement: string, evidence: BehavioralClaimEvidence[]): boolean {
  const statementTokens = new Set(words(statement).filter((token) => !STOPWORDS.has(token)));
  const evidenceTokens = new Set(words(evidence.map((item) => item.quote).join(" ")));
  let overlap = 0;
  for (const token of statementTokens) {
    if (evidenceTokens.has(token)) overlap += 1;
  }
  return overlap >= 2;
}

function parseClaim(
  sources: Record<AuthoredEvidenceField, string>,
  value: unknown,
  index: number,
): CharacterBehavioralClaim | null {
  const candidate = record(value);
  if (!candidate) return null;
  const statement = clean(candidate.statement).slice(0, 240);
  const evidenceClass = candidate.evidenceClass;
  if (!statement || !EVIDENCE_CLASSES.has(evidenceClass as BehavioralEvidenceClass)) return null;
  if (USER_CONTROL_PATTERN.test(statement)) return null;
  const evidence = (Array.isArray(candidate.evidence) ? candidate.evidence : [])
    .slice(0, 3)
    .flatMap((item): BehavioralClaimEvidence[] => {
      const row = record(item);
      const field = clean(row?.field) as BehavioralEvidenceField;
      const quote = clean(row?.quote).slice(0, 320);
      if (!AUTHORED_FIELDS.includes(field as AuthoredEvidenceField) || !quote) return [];
      return [{ field, quote }];
    });
  if (evidence.length === 0 || evidence.some((item) => !evidenceSupported(sources, item))) return null;
  if (BIOGRAPHY_PATTERN.test(statement) && !BIOGRAPHY_PATTERN.test(evidence.map((item) => item.quote).join(" "))) {
    return null;
  }
  if (!claimSupported(statement, evidence)) return null;
  return {
    id: `generated-${index}-${stableHash(`${statement}\n${JSON.stringify(evidence)}`)}`,
    statement,
    evidenceClass: evidenceClass as BehavioralEvidenceClass,
    evidence,
    source: "generated",
  };
}

export function validateBehavioralInterpretation(
  data: CharacterData,
  raw: unknown,
): CharacterBehavioralInterpretation | null {
  const value = record(raw);
  if (!value || !Array.isArray(value.claims)) return null;
  const sources = behavioralInterpretationSources(data);
  const claims = value.claims
    .slice(0, 8)
    .map((claim, index) => parseClaim(sources, claim, index))
    .filter((claim): claim is CharacterBehavioralClaim => claim !== null);
  const authored = normalize(Object.values(sources).join("\n"));
  const unique = uniqueClaims(
    [...claims].sort(
      (left, right) => Number(repeatsAuthoredText(authored, left)) - Number(repeatsAuthoredText(authored, right)),
    ),
  );
  if (unique.length === 0) return null;
  return {
    version: BEHAVIORAL_INTERPRETATION_VERSION,
    sourceHash: behavioralInterpretationSourceHash(data),
    status: "ready",
    enabled: true,
    claims: unique.slice(0, 5),
  };
}

export function isBehavioralInterpretationCurrent(
  data: CharacterData,
  profile: CharacterBehavioralInterpretation | null | undefined,
): boolean {
  return (
    profile?.version === BEHAVIORAL_INTERPRETATION_VERSION &&
    profile.status === "ready" &&
    profile.enabled !== false &&
    Array.isArray(profile.claims) &&
    profile.sourceHash === behavioralInterpretationSourceHash(data)
  );
}

function label(claim: CharacterBehavioralClaim): string {
  if (claim.source === "user_override") return "User correction";
  if (claim.evidenceClass === "explicit") return "Explicit";
  if (claim.evidenceClass === "strongly_implied") return "Strongly implied";
  return "Tentative";
}

export function packBehavioralInterpretation(
  data: CharacterData,
  profile: CharacterBehavioralInterpretation | null | undefined,
): string {
  if (!profile || !isBehavioralInterpretationCurrent(data, profile)) return "";
  const authored = normalize(Object.values(behavioralInterpretationSources(data)).join("\n"));
  const claims = uniqueClaims(
    [...profile.claims]
      .filter(
        (claim): claim is CharacterBehavioralClaim =>
          claim !== null &&
          typeof claim === "object" &&
          typeof claim.statement === "string" &&
          (claim.source === "generated" || claim.source === "user_override"),
      )
      .filter((claim) => !repeatsAuthoredText(authored, claim))
      .sort((left, right) => Number(right.source === "user_override") - Number(left.source === "user_override")),
  )
    .slice(0, 3);
  if (claims.length === 0) return "";
  return [
    "Derived behavioral interpretation (inspectable, non-canon):",
    "Authored card text and current scene events always win. Tentative claims are easy to override.",
    ...claims.map((claim) => `- ${label(claim)}: ${clean(claim.statement)}`),
  ].join("\n");
}
