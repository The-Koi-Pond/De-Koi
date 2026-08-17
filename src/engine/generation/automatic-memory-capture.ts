import type { LlmGateway } from "../capabilities/llm";
import type { ChatMemoryChunk } from "../contracts/types/chat";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryRecord, MemoryKind, MemoryScope } from "../contracts/types/memory";
import {
  canonicalInputCleanupSource,
  chatMemoryCleanupSource,
  cleanupScope,
} from "../entities/memory-maintenance-sources";
import { reviewMemoryValues } from "./memory-value-review";
import { isRecord, parseRecord, readString } from "./runtime-records";

type AutomaticMemoryCandidate = {
  kind?: unknown;
  content?: unknown;
  confidence?: unknown;
  supersedesMemoryId?: unknown;
  evidence?: unknown;
  sourceMessageIds?: unknown;
  referenceMessageIds?: unknown;
};

export type CanonicalConsequenceEvidence =
  | "direct_user_assertion"
  | "explicit_promise"
  | "explicit_screen_event"
  | "explicit_exchange";

export interface CanonicalConsequenceSourceMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId: string | null;
  createdAt: string;
  speakerLabel: string;
}

export interface CanonicalConsequenceExtractionRequest {
  version: 1;
  jobId: string;
  chatId: string;
  mode: string;
  scope: MemoryScope;
  activeCharacterId: string | null;
  userLabel: string;
  characterLabels: Record<string, string>;
  sourceMessages: CanonicalConsequenceSourceMessage[];
  referenceMessages: CanonicalConsequenceSourceMessage[];
  eligibleMemories: CanonicalMemoryRecord[];
  connectionId?: string | null;
  model?: string | null;
}

export interface CanonicalConsequenceExtractionResult {
  candidates: CanonicalMemoryInput[];
  skippedCount: number;
}

export interface PersistedCanonicalConsequence {
  operation: "created" | "updated" | "superseded";
  memory: CanonicalMemoryRecord;
}

export interface AutomaticMemoryValueGateResult {
  acceptedCanonicalCandidates: CanonicalMemoryInput[];
  acceptTranscriptCandidate: boolean;
  rejectedCandidateCount: number;
}

export type StandaloneMemoryFailure =
  | "generic_speaker_label"
  | "unresolved_opening_reference"
  | "dangling_topic_reference";

export type AutomaticCaptureMemoryFailure = StandaloneMemoryFailure | "third_person_personal_pronoun";

export function standaloneMemoryFailure(content: string): StandaloneMemoryFailure | null {
  const normalized = content.trim();
  const withoutUserToken = normalized.replace(/\{\{user\}\}|\{\{userName\}\}/gi, "");
  if (/\b(?:(?:the\s+)?user|character|assistant)(?:'s)?\b/i.test(withoutUserToken)) {
    return "generic_speaker_label";
  }
  if (/^(?:he|she|they|it|this|that|these|those)\b/i.test(normalized)) {
    return "unresolved_opening_reference";
  }
  if (/\b(?:talk|speak|discuss|argue|ask|worry)\w*\s+(?:about\s+)?(?:it|this|that)\b/i.test(normalized)) {
    return "dangling_topic_reference";
  }
  return null;
}

export function automaticCaptureMemoryFailure(content: string): AutomaticCaptureMemoryFailure | null {
  const standaloneFailure = standaloneMemoryFailure(content);
  if (standaloneFailure) return standaloneFailure;
  if (/\b(?:he|him|his|himself|she|her|hers|herself|they|them|their|theirs|themself|themselves)\b/i.test(content)) {
    return "third_person_personal_pronoun";
  }
  return null;
}

export async function reviewAutomaticMemoryCandidates(input: {
  llm: LlmGateway;
  connectionId: string;
  jobId: string;
  scope: MemoryScope;
  transcriptCandidate: ChatMemoryChunk | null;
  canonicalCandidates: CanonicalMemoryInput[];
  signal?: AbortSignal;
}): Promise<AutomaticMemoryValueGateResult> {
  const scope = cleanupScope(input.scope);
  const transcriptSource = input.transcriptCandidate ? chatMemoryCleanupSource(input.transcriptCandidate, scope) : null;
  const canonicalSources = input.canonicalCandidates.map((candidate, index) =>
    canonicalInputCleanupSource(`capture-candidate-${input.jobId}-${index}`, { ...candidate, status: "active" }),
  );
  const reviewSources = [...(transcriptSource ? [transcriptSource] : []), ...canonicalSources];
  const review = await reviewMemoryValues({
    scope,
    sources: reviewSources,
    connectionId: input.connectionId,
    llm: input.llm,
    signal: input.signal,
  });
  const rejectedIds = new Set(review.proposals.flatMap((proposal) => proposal.sourceIds));
  return {
    acceptedCanonicalCandidates: input.canonicalCandidates.filter(
      (_candidate, index) => !rejectedIds.has(`capture-candidate-${input.jobId}-${index}`),
    ),
    acceptTranscriptCandidate: input.transcriptCandidate !== null && !rejectedIds.has(input.transcriptCandidate.id),
    rejectedCandidateCount: rejectedIds.size,
  };
}

const CONSEQUENCE_KINDS = new Set<MemoryKind>([
  "fact",
  "relationship_state",
  "scene_event",
  "preference",
  "promise",
  "plot_state",
  "contradiction",
]);
const CANONICAL_MEMORY_KINDS = new Set<MemoryKind>([
  "episode",
  "fact",
  "scene_event",
  "relationship_state",
  "preference",
  "promise",
  "plot_state",
  "contradiction",
  "lore",
  "summary",
]);
const MEMORY_SCOPE_KINDS = new Set(["user", "character", "chat", "scene", "world", "agent"]);
const ACTIVE_CONFIDENCE_THRESHOLD = 0.7;
const MAX_CAPTURED_MEMORIES = 12;
const MAX_CONSEQUENCE_CONTENT_LENGTH = 500;
const CONSEQUENCE_EVIDENCE = new Set<CanonicalConsequenceEvidence>([
  "direct_user_assertion",
  "explicit_promise",
  "explicit_screen_event",
  "explicit_exchange",
]);
const EVIDENCE_STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "her",
  "his",
  "its",
  "not",
  "now",
  "our",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "user",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

export function canonicalMemoryEligibleForConsequences(value: unknown): value is CanonicalMemoryRecord {
  if (!isRecord(value)) return false;
  const scope = parseRecord(value.scope);
  const provenance = parseRecord(value.provenance);
  return (
    !!readString(value.id).trim() &&
    CANONICAL_MEMORY_KINDS.has(readString(value.kind).trim() as MemoryKind) &&
    (value.status === "active" || value.status === "pinned") &&
    MEMORY_SCOPE_KINDS.has(readString(scope.kind).trim()) &&
    !!readString(scope.id).trim() &&
    !!readString(value.content).trim() &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    Array.isArray(provenance.messageIds) &&
    provenance.messageIds.every((messageId) => typeof messageId === "string" && messageId.trim().length > 0) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string" && tag.trim().length > 0) &&
    isRecord(value.payload) &&
    !!readString(value.createdAt).trim() &&
    !!readString(value.updatedAt).trim()
  );
}

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function semanticConsequenceIdentity(candidate: CanonicalMemoryInput): string {
  const normalizedContent = candidate.content.trim().replace(/\s+/g, " ").toLowerCase();
  return `${candidate.scope.kind}:${candidate.scope.id}:${candidate.kind}:${stableHash(normalizedContent)}`;
}

function mergedProvenance(
  existing: CanonicalMemoryRecord,
  candidate: CanonicalMemoryInput,
): CanonicalMemoryInput["provenance"] {
  return {
    ...candidate.provenance,
    messageIds: Array.from(new Set([...existing.provenance.messageIds, ...candidate.provenance.messageIds])),
  };
}

export async function persistCanonicalMemoryConsequences(input: {
  storage: StorageGateway;
  candidates: CanonicalMemoryInput[];
  eligibleMemories: CanonicalMemoryRecord[];
  now: string;
}): Promise<{ affected: PersistedCanonicalConsequence[] }> {
  if (input.candidates.length === 0) return { affected: [] };
  if (!input.storage.createMemory || !input.storage.updateMemory) {
    throw new Error("Canonical memory storage is unavailable");
  }
  const eligibleById = new Map(
    input.eligibleMemories
      .filter(canonicalMemoryEligibleForConsequences)
      .filter((memory) => memory.status === "active")
      .map((memory) => [memory.id, memory]),
  );
  const affected: PersistedCanonicalConsequence[] = [];
  const seenSemanticIdentities = new Set<string>();

  for (const candidate of input.candidates) {
    const semanticIdentity = semanticConsequenceIdentity(candidate);
    if (seenSemanticIdentities.has(semanticIdentity)) continue;
    seenSemanticIdentities.add(semanticIdentity);
    const memoryId = `canonical-consequence-${stableHash(semanticIdentity)}`;
    const existing =
      (await input.storage.get<CanonicalMemoryRecord>("canonical-memories", memoryId).catch(() => null)) ??
      input.eligibleMemories
        .filter(canonicalMemoryEligibleForConsequences)
        .find((memory) => readString(parseRecord(memory.payload).semanticIdentity).trim() === semanticIdentity) ??
      null;
    const sourceChatIds = Array.from(
      new Set(
        [
          ...readStringArray(existing ? parseRecord(existing.payload).sourceChatIds : []),
          readString(existing?.provenance.sourceChatId).trim(),
          readString(candidate.provenance.sourceChatId).trim(),
        ].filter(Boolean),
      ),
    );
    const payload = {
      ...parseRecord(existing?.payload),
      ...parseRecord(candidate.payload),
      semanticIdentity,
      sourceChatIds,
    };
    const requestedSupersedesMemoryId = readString(candidate.supersedesMemoryId).trim();
    const supersedesMemoryId = eligibleById.has(requestedSupersedesMemoryId) ? requestedSupersedesMemoryId : null;
    let memory: CanonicalMemoryRecord;
    let operation: PersistedCanonicalConsequence["operation"];
    if (existing) {
      memory = await input.storage.updateMemory(existing.id, {
        kind: candidate.kind,
        status: existing.status === "pinned" ? "pinned" : candidate.status,
        scope: candidate.scope,
        content: candidate.content,
        confidence: Math.max(existing.confidence, candidate.confidence),
        provenance: mergedProvenance(existing, candidate),
        title: candidate.title,
        tags: Array.from(new Set([...existing.tags, ...(candidate.tags ?? [])])),
        supersedesMemoryId,
        payload,
      });
      operation = "updated";
    } else {
      memory = await input.storage.createMemory({
        ...candidate,
        id: memoryId,
        supersedesMemoryId,
        payload,
        createdAt: input.now,
        updatedAt: input.now,
      });
      operation = "created";
    }
    const superseded = supersedesMemoryId ? eligibleById.get(supersedesMemoryId) : undefined;
    affected.push({ operation, memory });
    if (superseded && superseded.id !== memory.id) {
      const supersededMemory = await input.storage.updateMemory(superseded.id, {
        status: "superseded",
        supersededByMemoryId: memory.id,
      });
      eligibleById.delete(superseded.id);
      affected.push({ operation: "superseded", memory: supersededMemory });
    }
  }

  return { affected };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => readString(entry).trim()).filter((entry) => entry.length > 0) : [];
}

function consequenceExtractionPrompt(request: CanonicalConsequenceExtractionRequest): string {
  const eligibleMemories = request.eligibleMemories.filter(canonicalMemoryEligibleForConsequences);
  const eligible =
    eligibleMemories.length > 0
      ? eligibleMemories
          .map((memory) => `${memory.id} | ${memory.kind} | ${memory.status} | ${memory.content}`)
          .join("\n")
      : "(none)";
  const exchange = request.sourceMessages
    .map((message) => `${message.id} | ${message.role} | ${message.speakerLabel} | ${message.content}`)
    .join("\n");
  const references =
    request.referenceMessages.length > 0
      ? request.referenceMessages
          .map((message) => `${message.id} | ${message.role} | ${message.speakerLabel} | ${message.content}`)
          .join("\n")
      : "(none)";
  return [
    "Extract only compact, durable consequences from this complete saved De-Koi exchange.",
    'Return JSON only: {"memories":[...]}',
    "Every memory must make sense as an isolated sentence.",
    `The user identity is ${request.userLabel}; never use User as a person's name.`,
    "Do not use third-person personal pronouns; repeat the supported person's name instead.",
    "Replace context-dependent it, this, or that with the actual supported subject when the subject matters.",
    "Any reporting or commitment clause naming a speaker must be supported by cited source rows from that named speaker.",
    "A commitment requires direct first-person intent such as I promise or I will; refusal or inability is not a commitment.",
    "Preserve explicit one, single, this, or that scope; never broaden a specific observation into an unqualified class-wide statement.",
    "Preserve each proposition's positive or negative polarity; never invert what a cited row says.",
    "Preserve conditions, tense, uncertainty, and modality, including which clause is conditional; never turn if, will, may, might, could, probably, seems, or similar qualified wording into an asserted fact.",
    "Preserve each direct subject's identity; never replace one known participant with another.",
    "Bind first-person forms anywhere in a cited row to that row's named speaker; never bind second-person you to the speaker.",
    "Preserve unresolved second-person argument slots such as you or your; never replace them with another name or topic without explicit addressee evidence.",
    "Preserve reporting acts and their certainty; never replace claimed with confirmed or another different act.",
    "Older reference messages may resolve only a bare name or antecedent identity; they cannot prove descriptors, appositives, relative clauses, or a new claim.",
    "Each item must include kind, content, confidence, evidence, and sourceMessageIds.",
    "Each item may include referenceMessageIds in addition to sourceMessageIds.",
    "Allowed kinds: fact, preference, promise, relationship_state, scene_event, plot_state, contradiction.",
    "Allowed evidence: direct_user_assertion, explicit_promise, explicit_screen_event, explicit_exchange.",
    "Do not turn assistant guesses, decorative prose, tentative interpretations, or unsupported inferences into canon.",
    "A fact or preference about the user must cite a direct user assertion.",
    "Use only source and reference message IDs shown below in their matching fields.",
    "Set supersedesMemoryId only to an eligible memory ID shown below; otherwise omit it.",
    `Mode: ${request.mode}`,
    `Scope: ${request.scope.kind}:${request.scope.id}`,
    "Eligible memories:",
    eligible,
    "Saved exchange:",
    exchange,
    "Older reference context:",
    references,
  ].join("\n");
}

function consequenceKind(candidate: AutomaticMemoryCandidate): MemoryKind | null {
  const kind = readString(candidate.kind).trim() as MemoryKind;
  return CONSEQUENCE_KINDS.has(kind) ? kind : null;
}

function validConsequenceEvidence(value: unknown): CanonicalConsequenceEvidence | null {
  const normalized = readString(value).trim() as CanonicalConsequenceEvidence;
  return CONSEQUENCE_EVIDENCE.has(normalized) ? normalized : null;
}

function evidenceToken(value: string): string {
  const singular = value.length > 4 && value.endsWith("s") ? value.slice(0, -1) : value;
  return singular.length > 6 && singular.startsWith("dis") ? singular.slice(3) : singular;
}

function evidenceTokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(evidenceToken)
      .filter((token) => token.length >= 3 && !EVIDENCE_STOP_WORDS.has(token)),
  );
}

const NEGATIVE_POLARITY =
  /\b(?:cannot|never|no|not|without|distrust(?:s|ed|ing)?|won't|wouldn't|can't|couldn't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|shouldn't|mustn't)\b/i;

function hasNegativePolarity(content: string): boolean {
  return NEGATIVE_POLARITY.test(content.replaceAll("’", "'"));
}

const MATERIAL_MODALITY = [
  /\b(?:may|might|could|perhaps|possibly|probably|likely|seems?|appears?)\b|\bnot\s+sure\s+(?:if|whether)\b/i,
  /\b(?:can|cannot|can't)\b/i,
  /\bmust\b/i,
  /\bshould\b/i,
  /\bwould\b/i,
  /\b(?:will|shall|promise[ds]?|commit(?:s|ted)?|vow(?:s|ed)?|pledge[ds]?|swear(?:s)?|swore|agree[ds]?)\b/i,
] as const;

function materialModality(content: string): string {
  const normalized = content.replaceAll("’", "'");
  return MATERIAL_MODALITY.map((pattern, index) => (pattern.test(normalized) ? String(index) : "")).join("");
}

function claimSupportingEvidenceClauses(claim: string, evidence: string, evidenceSpeakerLabel?: string): string[] {
  const evidencePropositionList = evidencePropositions(evidence);
  const supportingPropositions = new Set<string>();
  for (const claimProposition of evidencePropositions(claim)) {
    const claimTokens = evidenceTokens(claimProposition);
    if (claimTokens.size === 0) return [];
    const matches = evidencePropositionList.filter((evidenceProposition) => {
      const evidenceTokenSet = evidenceTokens(evidenceProposition);
      if (evidenceSpeakerLabel && /\b(?:i|me|mine|my|myself|our|ours|ourselves|us|we)\b/i.test(evidenceProposition)) {
        evidenceTokens(evidenceSpeakerLabel).forEach((token) => evidenceTokenSet.add(token));
      }
      return (
        hasNegativePolarity(evidenceProposition) === hasNegativePolarity(claimProposition) &&
        [...claimTokens].every((token) => evidenceTokenSet.has(token))
      );
    });
    if (matches.length === 0) return [];
    matches.forEach((match) => supportingPropositions.add(match));
  }
  return [...supportingPropositions];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REPORTING_OR_COMMITMENT_VERB =
  "(?:said|says|stated|states|reported|reports|told|tells|explained|explains|confirmed|confirms|" +
  "believed|believes|discussed|discusses|promised|promises|committed|commits|agreed|agrees|" +
  "vowed|vows|pledged|pledges|swore|swears|claimed|claims|mentioned|mentions|asked|asks|warned|warns)";
const COMMITMENT_REPORTING_VERB =
  /^(?:promised|promises|committed|commits|agreed|agrees|vowed|vows|pledged|pledges|swore|swears)$/i;
const DIRECT_FIRST_PERSON_COMMITMENT_ACT =
  /\b(?:I|we)\s+(?:promise[ds]?|commit(?:s|ted)?|vow(?:s|ed)?|pledge[ds]?|swear(?:s)?|swore|agree[ds]?)\b/i;
const DIRECT_FIRST_PERSON_FUTURE_INTENT = /\b(?:I|we)(?:'ll|\s+(?:will|shall|am\s+going\s+to|are\s+going\s+to))\b/i;
const NEGATED_EXPLICIT_COMMITMENT_ACT =
  /\b(?:cannot|never|not|can't|couldn't|didn't|doesn't|don't|won't|wouldn't)\s+(?:promise[ds]?|commit(?:s|ted)?|vow(?:s|ed)?|pledge[ds]?|swear(?:s)?|swore|agree[ds]?)\b/i;

function hasCommitmentActEvidence(content: string): boolean {
  return (
    (DIRECT_FIRST_PERSON_COMMITMENT_ACT.test(content) || DIRECT_FIRST_PERSON_FUTURE_INTENT.test(content)) &&
    !NEGATED_EXPLICIT_COMMITMENT_ACT.test(content)
  );
}

function knownSpeakerLabels(request: CanonicalConsequenceExtractionRequest): string[] {
  return Array.from(
    new Set(
      [
        request.userLabel,
        ...Object.values(request.characterLabels),
        ...request.sourceMessages.map((message) => message.speakerLabel),
        ...request.referenceMessages.map((message) => message.speakerLabel),
      ]
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);
}

function knownSpeakerTokens(request: CanonicalConsequenceExtractionRequest): Set<string> {
  return new Set(knownSpeakerLabels(request).flatMap((label) => label.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
}

function messageBelongsToSpeaker(
  message: CanonicalConsequenceSourceMessage,
  speakerLabel: string,
  request: CanonicalConsequenceExtractionRequest,
): boolean {
  const normalizedLabel = speakerLabel.trim().toLowerCase();
  if (message.speakerLabel.trim().toLowerCase() === normalizedLabel) return true;
  if (request.userLabel.trim().toLowerCase() === normalizedLabel && message.role === "user") return true;
  return Object.entries(request.characterLabels).some(
    ([characterId, label]) => label.trim().toLowerCase() === normalizedLabel && message.characterId === characterId,
  );
}

function namedReportingClausesSupportedByEvidence(
  content: string,
  evidenceMessages: CanonicalConsequenceSourceMessage[],
  request: CanonicalConsequenceExtractionRequest,
): boolean {
  const speakerLabels = knownSpeakerLabels(request);
  if (speakerLabels.length === 0) return true;
  const speakerAlternation = speakerLabels.map(escapeRegExp).join("|");
  const namedSpeaker = `(?:${speakerAlternation})`;
  const reportingSubject = `(${namedSpeaker}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)${namedSpeaker})*)`;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${reportingSubject}\\s+(?:(?:has|have|had)\\s+)?(${REPORTING_OR_COMMITMENT_VERB})\\b([^.!?;]*)`,
    "giu",
  );
  for (const match of content.matchAll(pattern)) {
    const subject = match[1]?.trim() ?? "";
    const reportingVerb = match[2]?.trim() ?? "";
    const claim = match[3]?.trim() ?? "";
    const subjectLabelPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${speakerAlternation})(?![\\p{L}\\p{N}_])`, "giu");
    const subjectLabels = [...subject.matchAll(subjectLabelPattern)].map((labelMatch) => labelMatch[1]?.trim() ?? "");
    for (const speakerLabel of subjectLabels) {
      const speakerEvidence = evidenceMessages.filter((message) =>
        messageBelongsToSpeaker(message, speakerLabel, request),
      );
      if (
        speakerEvidence.length === 0 ||
        !speakerEvidence.some((message) => {
          const supportingClauses = claimSupportingEvidenceClauses(claim, message.content, message.speakerLabel);
          return supportingClauses.some(
            (clause) => !COMMITMENT_REPORTING_VERB.test(reportingVerb) || hasCommitmentActEvidence(clause),
          );
        })
      ) {
        return false;
      }
    }
  }
  const attributedFrame = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])(?:According\\s+to|Per)\\s+(${speakerAlternation})\\s*,?\\s*([^.!?;]*)`,
    "giu",
  );
  for (const match of content.matchAll(attributedFrame)) {
    const speakerLabel = match[1]?.trim() ?? "";
    const claim = match[2]?.trim() ?? "";
    const speakerEvidence = evidenceMessages.filter((message) =>
      messageBelongsToSpeaker(message, speakerLabel, request),
    );
    if (
      speakerEvidence.length === 0 ||
      !speakerEvidence.some(
        (message) => claimSupportingEvidenceClauses(claim, message.content, message.speakerLabel).length > 0,
      )
    ) {
      return false;
    }
  }
  return true;
}

function evidenceClauses(content: string): string[] {
  return content
    .split(/[.!?;:]+|\s+(?:but|while|whereas)\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function evidencePropositions(content: string): string[] {
  return content
    .split(/[.!?;:]+|\s+(?:and|or|but|while|whereas)\s+/i)
    .map((proposition) => proposition.trim())
    .filter(Boolean);
}

const PROPOSITION_FILLER_WORDS = new Set([
  "according",
  "another",
  "about",
  "can",
  "could",
  "did",
  "do",
  "does",
  "going",
  "had",
  "is",
  "may",
  "might",
  "must",
  "name",
  "named",
  "per",
  "please",
  "shall",
  "should",
  "will",
  "would",
]);

const LEADING_REPORTING_FRAME_WORDS = new Set([
  "agreed",
  "agrees",
  "claimed",
  "claims",
  "committed",
  "commits",
  "confirmed",
  "confirms",
  "explained",
  "explains",
  "mentioned",
  "mentions",
  "pledged",
  "pledges",
  "promised",
  "promises",
  "reported",
  "reports",
  "said",
  "says",
  "stated",
  "states",
  "swore",
  "swears",
  "told",
  "tells",
  "vowed",
  "vows",
]);

const FIRST_PERSON_REFERENCE_WORDS = new Set([
  "i",
  "me",
  "mine",
  "my",
  "myself",
  "our",
  "ours",
  "ourselves",
  "us",
  "we",
]);
const SECOND_PERSON_REFERENCE_WORDS = new Set(["you", "your", "yours", "yourself", "yourselves"]);

function propositionReportingFrame(value: string, ignoredSpeakerTokens: Set<string>): string | null {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reportingIndex = words.findIndex((word) => LEADING_REPORTING_FRAME_WORDS.has(word));
  if (
    reportingIndex > 0 &&
    words
      .slice(0, reportingIndex)
      .every((word) => ignoredSpeakerTokens.has(word) || word === "and" || word === "has" || word === "have")
  ) {
    return words[reportingIndex] ?? null;
  }
  return null;
}

function propositionContentTokens(
  value: string,
  ignoredSpeakerTokens: Set<string>,
  resolvedSpeakerLabel?: string,
  omitFirstPersonSubjects = false,
): string[] {
  const tokenizable = value
    .toLowerCase()
    .replace(/\b(?:aren|couldn|didn|doesn|don|hadn|hasn|haven|isn|mustn|shouldn|wasn|weren|won|wouldn)['’]t\b/gu, " ");
  const words: string[] = tokenizable.match(/[\p{L}\p{N}]+/gu) ?? [];
  let contentStart = 0;
  const reportingFrame = propositionReportingFrame(value, ignoredSpeakerTokens);
  if (reportingFrame !== null) {
    contentStart = words.indexOf(reportingFrame) + 1;
  } else if (words[0] === "according" && words[1] === "to") {
    contentStart = 2;
    while (contentStart < words.length && ignoredSpeakerTokens.has(words[contentStart] ?? "")) contentStart += 1;
  } else if (words[0] === "per") {
    contentStart = 1;
    while (contentStart < words.length && ignoredSpeakerTokens.has(words[contentStart] ?? "")) contentStart += 1;
  }
  const resolvedSpeakerTokens = resolvedSpeakerLabel?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = resolvedSpeakerTokens.length > 0 && words[0] === "please" ? [...resolvedSpeakerTokens] : [];
  for (const token of words.slice(contentStart)) {
    if (resolvedSpeakerTokens.length > 0 && FIRST_PERSON_REFERENCE_WORDS.has(token)) {
      if (omitFirstPersonSubjects && (token === "i" || token === "we")) continue;
      tokens.push(...resolvedSpeakerTokens);
      continue;
    }
    if (SECOND_PERSON_REFERENCE_WORDS.has(token)) {
      tokens.push(token);
      continue;
    }
    if (ignoredSpeakerTokens.has(token)) {
      tokens.push(token);
      continue;
    }
    if (
      token.length < 3 ||
      token === "one" ||
      token === "single" ||
      EVIDENCE_STOP_WORDS.has(token) ||
      PROPOSITION_FILLER_WORDS.has(token)
    ) {
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function surfaceForms(token: string): Set<string> {
  const forms = new Set([token]);
  if (token === "kept") forms.add("keep");
  if (token.length > 4 && token.endsWith("ies")) forms.add(`${token.slice(0, -3)}y`);
  if (/(?:ches|shes|sses|xes|zes|oes)$/.test(token)) forms.add(token.slice(0, -2));
  if (token.length > 4 && token.endsWith("s")) forms.add(token.slice(0, -1));
  if (token.length > 4 && token.endsWith("ed")) {
    forms.add(token.slice(0, -2));
    forms.add(token.slice(0, -1));
  }
  if (forms.has("discuss")) forms.add("talk");
  if (forms.has("talk")) forms.add("discuss");
  return forms;
}

function surfaceTokensMatch(left: string, right: string): boolean {
  const leftPast = left === "kept" || (left.length > 4 && left.endsWith("ed"));
  const rightPast = right === "kept" || (right.length > 4 && right.endsWith("ed"));
  if (leftPast !== rightPast) return false;
  const rightForms = surfaceForms(right);
  return [...surfaceForms(left)].some((form) => rightForms.has(form));
}

function orderedSurfaceMatchIndexes(
  candidateTokens: string[],
  evidenceTokensForProposition: string[],
  candidate: string,
  evidence: string,
): number[] | null {
  const preferenceRequest = /^prefer/.test(candidateTokens[0] ?? "") && /\bplease\b/i.test(evidence);
  const effectiveCandidateTokens = preferenceRequest
    ? candidateTokens.filter((token, index) => index === 0 || token !== "kept")
    : candidateTokens;
  const indexes: number[] = [];
  let evidenceIndex = 0;
  for (const [candidateIndex, candidateToken] of effectiveCandidateTokens.entries()) {
    let matchIndex = -1;
    for (; evidenceIndex < evidenceTokensForProposition.length; evidenceIndex += 1) {
      const evidenceTokenValue = evidenceTokensForProposition[evidenceIndex] ?? "";
      const controlledPreferenceMatch = preferenceRequest && candidateIndex === 0 && /^keep/.test(evidenceTokenValue);
      const controlledNegativeMatch =
        hasNegativePolarity(candidate) &&
        ((/^trust/.test(candidateToken) && /^distrust/.test(evidenceTokenValue)) ||
          (/^distrust/.test(candidateToken) && /^trust/.test(evidenceTokenValue)));
      if (
        surfaceTokensMatch(candidateToken, evidenceTokenValue) ||
        controlledPreferenceMatch ||
        controlledNegativeMatch
      ) {
        matchIndex = evidenceIndex;
        evidenceIndex += 1;
        break;
      }
    }
    if (matchIndex < 0) return null;
    indexes.push(matchIndex);
  }
  return indexes;
}

function evidenceTokenMatchIndexes(evidenceTokensForProposition: string[], candidateTokens: string[]): number[] | null {
  const indexes: number[] = [];
  let candidateIndex = 0;
  for (const evidenceTokenValue of evidenceTokensForProposition) {
    let matched = false;
    for (; candidateIndex < candidateTokens.length; candidateIndex += 1) {
      if (surfaceTokensMatch(evidenceTokenValue, candidateTokens[candidateIndex] ?? "")) {
        indexes.push(candidateIndex);
        candidateIndex += 1;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return indexes;
}

function sameSurfaceTokenMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  for (const leftToken of left) {
    const index = unmatched.findIndex((rightToken) => surfaceTokensMatch(leftToken, rightToken));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

function sameSurfaceTokenMultisetIgnoringTense(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  for (const leftToken of left) {
    const index = unmatched.findIndex((rightToken) =>
      [...surfaceForms(leftToken)].some((form) => surfaceForms(rightToken).has(form)),
    );
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

function roleTokens(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length >= 2 && token !== "the" && token !== "an",
  );
}

function firstPersonActivePassiveParaphrase(
  candidate: string,
  evidence: string,
  evidenceSpeakerLabel: string,
): boolean {
  const passive = candidate.match(/^\s*(.+?)\s+(am|is|are|was|were)\s+([\p{L}]+ed)\s+by\s+(.+?)[.!?]*\s*$/iu);
  const active = evidence.match(/^\s*(.+?)\s+([\p{L}]+(?:s|ed))\s+(?:me|us|myself|ourselves)[.!?]*\s*$/iu);
  if (!passive || !active) return false;
  const passiveIsPast = /^(?:was|were)$/i.test(passive[2] ?? "");
  const activeIsPast = (active[2] ?? "").endsWith("ed");
  if (passiveIsPast !== activeIsPast) return false;
  if (roleTokens(passive[1] ?? "").join("\u0000") !== roleTokens(evidenceSpeakerLabel).join("\u0000")) return false;
  if (roleTokens(passive[4] ?? "").join("\u0000") !== roleTokens(active[1] ?? "").join("\u0000")) return false;
  return [...surfaceForms(passive[3] ?? "")].some((form) => surfaceForms(active[2] ?? "").has(form));
}

function possessiveCopularNamingParaphrase(candidate: string, evidence: string): boolean {
  return (
    /(?:\}\}|[\p{L}\p{N}]+)['’]s\b[^.!?;]*\bis\s+named\b/iu.test(candidate) &&
    /\b(?:my|your|his|her|our|their)\b/iu.test(evidence)
  );
}

function unresolvedReferenceSupported(
  candidate: string,
  candidateTokens: string[],
  evidenceTokensForProposition: string[],
  resolutionContext: string,
): boolean {
  if (/[,;:\u2013\u2014]|\b(?:that|which|who)\b/i.test(candidate)) return false;
  const evidenceIndexes = evidenceTokenMatchIndexes(evidenceTokensForProposition, candidateTokens);
  if (!evidenceIndexes) return false;
  const matchedCandidateIndexes = new Set(evidenceIndexes);
  const unresolvedCandidateTokens = candidateTokens.filter((_, index) => !matchedCandidateIndexes.has(index));
  if (unresolvedCandidateTokens.length === 0) return false;
  if (
    unresolvedCandidateTokens.length > 4 ||
    unresolvedCandidateTokens.some(
      (token) =>
        (token.length > 4 && /(?:ed|ing|ly)$/.test(token)) ||
        /^(?:been|broken|done|found|gone|known|lost|seen|stolen|taken|torn|written|yesterday|today|tonight|tomorrow)$/.test(
          token,
        ),
    )
  ) {
    return false;
  }
  const resolutionWords = resolutionContext.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let start = 0; start <= resolutionWords.length - unresolvedCandidateTokens.length; start += 1) {
    if (
      unresolvedCandidateTokens.every((candidateToken, offset) =>
        surfaceTokensMatch(candidateToken, resolutionWords[start + offset] ?? ""),
      )
    ) {
      return true;
    }
  }
  return false;
}

function preferenceRequestEquivalent(
  candidateTokens: string[],
  evidenceTokensForProposition: string[],
  evidence: string,
): boolean {
  const preferenceIndex = candidateTokens.findIndex((token) => /^prefer/.test(token));
  if (preferenceIndex < 0 || !/\bplease\b/i.test(evidence)) return false;
  const normalizedCandidate = candidateTokens
    .filter((token, index) => index <= preferenceIndex || token !== "kept")
    .map((token, index) => (index === preferenceIndex ? "keep" : token));
  return (
    normalizedCandidate.length === evidenceTokensForProposition.length &&
    normalizedCandidate.every((token, index) => surfaceTokensMatch(token, evidenceTokensForProposition[index] ?? ""))
  );
}

const COMMITMENT_CONTENT_TOKEN =
  /^(?:promise[ds]?|commit(?:s|ted)?|vow(?:s|ed)?|pledge[ds]?|swear(?:s)?|swore|agree[ds]?)$/i;

function directCommitmentEquivalent(
  candidate: string,
  evidence: string,
  candidateTokens: string[],
  evidenceTokensForProposition: string[],
): boolean {
  if (!/\b(?:promised|committed|vowed|pledged|swore|agreed)\b/i.test(candidate)) return false;
  if (!hasCommitmentActEvidence(evidence)) return false;
  const evidenceClaimTokens = evidenceTokensForProposition.filter((token) => !COMMITMENT_CONTENT_TOKEN.test(token));
  return (
    candidateTokens.length === evidenceClaimTokens.length &&
    candidateTokens.every((token, index) => surfaceTokensMatch(token, evidenceClaimTokens[index] ?? ""))
  );
}

const CONDITION_MARKERS = new Set(["if", "unless", "when", "provided", "assuming"]);

function conditionBindings(value: string, ignoredSpeakerTokens: Set<string>): string[] {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const bindings: string[] = [];
  let materialTokenCount = 0;
  for (const word of words) {
    if (CONDITION_MARKERS.has(word)) {
      bindings.push(`${word}:${materialTokenCount}`);
      continue;
    }
    if (
      word.length < 3 ||
      word === "one" ||
      word === "single" ||
      ignoredSpeakerTokens.has(word) ||
      EVIDENCE_STOP_WORDS.has(word) ||
      PROPOSITION_FILLER_WORDS.has(word)
    ) {
      continue;
    }
    materialTokenCount += 1;
  }
  return bindings;
}

function propositionSupported(
  candidate: string,
  evidence: string,
  ignoredSpeakerTokens: Set<string>,
  resolutionContext: string,
  evidenceSpeakerLabel: string,
): boolean {
  if (hasNegativePolarity(candidate) !== hasNegativePolarity(evidence)) return false;
  if (materialModality(candidate) !== materialModality(evidence)) return false;
  const candidateConditions = conditionBindings(candidate, ignoredSpeakerTokens);
  const evidenceConditions = conditionBindings(evidence, ignoredSpeakerTokens);
  if (candidateConditions.join("\u0000") !== evidenceConditions.join("\u0000")) return false;
  const activePassiveParaphrase = firstPersonActivePassiveParaphrase(candidate, evidence, evidenceSpeakerLabel);
  const candidateCopula = /\b(?:was|were)\b/i.test(candidate)
    ? "past"
    : /\b(?:am|is|are)\b/i.test(candidate)
      ? "present"
      : "";
  const evidenceCopula = /\b(?:was|were)\b/i.test(evidence)
    ? "past"
    : /\b(?:am|is|are)\b/i.test(evidence)
      ? "present"
      : "";
  if (candidateCopula !== evidenceCopula && !activePassiveParaphrase) return false;
  const candidateReportingAct = propositionReportingFrame(candidate, ignoredSpeakerTokens);
  const evidenceReportingAct = propositionReportingFrame(evidence, ignoredSpeakerTokens);
  if (evidenceReportingAct !== null && evidenceReportingAct !== candidateReportingAct) return false;
  const namingParaphrase = possessiveCopularNamingParaphrase(candidate, evidence);
  const candidateTokens = propositionContentTokens(candidate, ignoredSpeakerTokens);
  const evidenceTokensForProposition = propositionContentTokens(
    evidence,
    ignoredSpeakerTokens,
    evidenceSpeakerLabel,
    candidateReportingAct !== null,
  );
  if (namingParaphrase) {
    const speakerTokens = evidenceSpeakerLabel.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const alreadyContainsSpeaker = evidenceTokensForProposition.some((_token, start) =>
      speakerTokens.every((token, offset) => evidenceTokensForProposition[start + offset] === token),
    );
    if (!alreadyContainsSpeaker) {
      evidenceTokensForProposition.unshift(...speakerTokens);
    }
  }
  if (candidateTokens.length === 0) return true;
  if (/\bit\b/i.test(evidence)) {
    return unresolvedReferenceSupported(candidate, candidateTokens, evidenceTokensForProposition, resolutionContext);
  }
  if (namingParaphrase && sameSurfaceTokenMultiset(candidateTokens, evidenceTokensForProposition)) {
    return true;
  }
  if (activePassiveParaphrase && sameSurfaceTokenMultisetIgnoringTense(candidateTokens, evidenceTokensForProposition)) {
    return true;
  }
  if (preferenceRequestEquivalent(candidateTokens, evidenceTokensForProposition, evidence)) return true;
  const matchIndexes = orderedSurfaceMatchIndexes(candidateTokens, evidenceTokensForProposition, candidate, evidence);
  if (!matchIndexes) return false;
  if (directCommitmentEquivalent(candidate, evidence, candidateTokens, evidenceTokensForProposition)) return true;
  return orderedSurfaceMatchIndexes(evidenceTokensForProposition, candidateTokens, evidence, candidate) !== null;
}

function evidencePolarityPreserved(
  content: string,
  evidenceMessages: CanonicalConsequenceSourceMessage[],
  ignoredSpeakerTokens: Set<string>,
  referenceMessages: CanonicalConsequenceSourceMessage[],
): boolean {
  const resolutionContext = [...evidenceMessages, ...referenceMessages].map((message) => message.content).join(" ");
  const evidencePropositionList = evidenceMessages.flatMap((message) =>
    evidencePropositions(message.content).map((content) => ({ content, speakerLabel: message.speakerLabel })),
  );
  return evidencePropositions(content).every((candidateProposition) =>
    evidencePropositionList.some((evidenceProposition) =>
      propositionSupported(
        candidateProposition,
        evidenceProposition.content,
        ignoredSpeakerTokens,
        resolutionContext,
        evidenceProposition.speakerLabel,
      ),
    ),
  );
}

function specificityComparisonTokens(content: string): Set<string> {
  const tokens = evidenceTokens(content);
  tokens.delete("one");
  tokens.delete("single");
  return tokens;
}

function specificityClauseMatchesCandidate(sourceClause: string, candidateClause: string): boolean {
  const sourceTokens = specificityComparisonTokens(sourceClause);
  const candidateTokens = specificityComparisonTokens(candidateClause);
  const overlap = [...candidateTokens].filter((token) => sourceTokens.has(token)).length;
  return overlap >= 2;
}

const NOMINAL_SCOPE_DETERMINERS = new Set(["a", "an", "one", "single", "that", "the", "this"]);
const SINGULAR_AGREEMENT = new Set(["does", "has", "is", "was"]);
const IRREGULAR_PLURAL_TO_SINGULAR = new Map([
  ["children", "child"],
  ["feet", "foot"],
  ["geese", "goose"],
  ["men", "man"],
  ["mice", "mouse"],
  ["oxen", "ox"],
  ["people", "person"],
  ["teeth", "tooth"],
  ["women", "woman"],
]);
const SAME_FORM_PLURALS = new Set(["deer", "fish", "series", "sheep", "species"]);
const PLURAL_AGREEMENT = new Set(["are", "do", "have", "were"]);
const PLURAL_AGREEMENT_FOR_SINGULAR = new Map<string, string>([
  ["does", "do"],
  ["has", "have"],
  ["is", "are"],
  ["was", "were"],
]);

function candidateSingularForms(word: string): string[] {
  const irregular = IRREGULAR_PLURAL_TO_SINGULAR.get(word);
  if (irregular) return [irregular];
  if (word.length > 4 && word.endsWith("ies")) return [`${word.slice(0, -3)}y`];
  if (/(?:ches|shes|sses|xes|zes)$/.test(word)) return [word.slice(0, -2)];
  if (word.length > 4 && word.endsWith("ves")) {
    const stem = word.slice(0, -3);
    return [`${stem}f`, `${stem}fe`];
  }
  return word.length > 4 && word.endsWith("s") ? [word.slice(0, -1)] : [];
}

function thirdPersonAgreementBases(word: string): string[] {
  if (word.length > 4 && word.endsWith("ies")) return [`${word.slice(0, -3)}y`];
  if (/(?:ches|shes|sses|xes|zes|oes)$/.test(word)) return [word.slice(0, -2)];
  return word.length > 4 && word.endsWith("s") ? [word.slice(0, -1)] : [];
}

function broadensSingularEvidence(sourceClause: string, candidateClause: string): boolean {
  const sourceWordList = sourceClause.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const scopedSingularNouns = new Set(
    sourceWordList.filter((_word, index) => {
      const precedingWords = sourceWordList.slice(Math.max(0, index - 2), index);
      return (
        NOMINAL_SCOPE_DETERMINERS.has(precedingWords[0] ?? "") ||
        NOMINAL_SCOPE_DETERMINERS.has(precedingWords[1] ?? "") ||
        SINGULAR_AGREEMENT.has(sourceWordList[index + 1] ?? "")
      );
    }),
  );
  const sourceWords = new Set(sourceWordList);
  const candidateWords: string[] = candidateClause.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    sourceWordList.some(
      (sourceWord) =>
        !candidateWords.includes(sourceWord) &&
        thirdPersonAgreementBases(sourceWord).some((base) => candidateWords.includes(base)),
    )
  ) {
    return true;
  }
  if (
    [...PLURAL_AGREEMENT_FOR_SINGULAR].some(
      ([singular, plural]) =>
        sourceWords.has(singular) && !candidateWords.includes(singular) && candidateWords.includes(plural),
    )
  ) {
    return true;
  }
  return candidateWords.some((word, index) => {
    if (
      SAME_FORM_PLURALS.has(word) &&
      scopedSingularNouns.has(word) &&
      candidateWords.slice(index + 1, index + 4).some((followingWord) => PLURAL_AGREEMENT.has(followingWord))
    )
      return true;
    return !sourceWords.has(word) && candidateSingularForms(word).some((singular) => scopedSingularNouns.has(singular));
  });
}

const FINITE_CLAUSE_MARKERS = new Set([
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "was",
  "were",
  "will",
  "would",
]);
const CLEAR_CLAUSE_SUBJECTS = new Set([
  "a",
  "an",
  "he",
  "her",
  "his",
  "i",
  "it",
  "my",
  "our",
  "she",
  "the",
  "their",
  "they",
  "we",
  "you",
  "your",
]);

function thatStartsClearFiniteClause(content: string, afterThat: number): boolean {
  const words =
    content
      .slice(afterThat)
      .trimStart()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const finiteIndex = words.slice(0, 4).findIndex((word) => FINITE_CLAUSE_MARKERS.has(word.toLowerCase()));
  if (finiteIndex === 0) return true;
  if (finiteIndex < 1) return false;
  const firstWord = words[0] ?? "";
  const normalizedFirst = firstWord.toLowerCase();
  return (
    CLEAR_CLAUSE_SUBJECTS.has(normalizedFirst) ||
    /^\p{Lu}/u.test(firstWord) ||
    (normalizedFirst.endsWith("s") && /^(?:are|do|have|were)$/.test(words[finiteIndex]?.toLowerCase() ?? ""))
  );
}

interface SpecificityBinding {
  anchor: string | null;
  kind: "singular" | "demonstrative";
  tokens: Set<string>;
}

function specificityBindings(content: string): SpecificityBinding[] {
  const words = [...content.matchAll(/[\p{L}\p{N}]+/gu)];
  const bindings: SpecificityBinding[] = [];
  for (const [index, match] of words.entries()) {
    const marker = match[0].toLowerCase();
    let kind: SpecificityBinding["kind"] | null = null;
    const followingWords = words.slice(index + 1);
    const articleIntroducesSingularScope =
      marker === "a" ||
      marker === "an" ||
      (marker === "the" &&
        followingWords.slice(0, 5).some((wordMatch) => SINGULAR_AGREEMENT.has(wordMatch[0].toLowerCase())));
    if (articleIntroducesSingularScope || marker === "one" || marker === "single") kind = "singular";
    if (marker === "this") kind = "demonstrative";
    if (marker === "that" && !thatStartsClearFiniteClause(content, match.index + match[0].length)) {
      kind = "demonstrative";
    }
    if (!kind) continue;
    const orderedTokens = followingWords
      .map((wordMatch) => evidenceToken(wordMatch[0].toLowerCase()))
      .filter((token) => token.length >= 3 && token !== "one" && token !== "single" && !EVIDENCE_STOP_WORDS.has(token))
      .slice(0, 5);
    bindings.push({ anchor: orderedTokens.at(-1) ?? null, kind, tokens: new Set(orderedTokens) });
  }
  return bindings;
}

function specificityBindingSupported(source: SpecificityBinding, candidates: SpecificityBinding[]): boolean {
  return candidates.some((candidate) => {
    if (candidate.kind !== source.kind || source.tokens.size === 0 || candidate.tokens.size === 0) return false;
    if (candidate.anchor !== source.anchor) return false;
    return [...source.tokens].every((token) => candidate.tokens.has(token));
  });
}

function evidenceSpecificityPreserved(content: string, evidenceMessages: CanonicalConsequenceSourceMessage[]): boolean {
  const candidateClauses = evidenceClauses(content);
  for (const sourceClause of evidenceMessages.flatMap((message) => evidenceClauses(message.content))) {
    const sourceBindings = specificityBindings(sourceClause);
    for (const candidateClause of candidateClauses) {
      if (!specificityClauseMatchesCandidate(sourceClause, candidateClause)) continue;
      if (broadensSingularEvidence(sourceClause, candidateClause)) return false;
      const candidateBindings = specificityBindings(candidateClause);
      if (sourceBindings.some((binding) => !specificityBindingSupported(binding, candidateBindings))) return false;
    }
  }
  return true;
}

export function contentSupportedByEvidence(content: string, messages: CanonicalConsequenceSourceMessage[]): boolean {
  const contentTokens = evidenceTokens(content);
  const sourceTokens = evidenceTokens(
    messages.map((message) => `${message.speakerLabel} ${message.content}`).join(" "),
  );
  const overlap = [...contentTokens].filter((token) => sourceTokens.has(token)).length;
  return overlap >= 2;
}

function evidenceSupportsKind(
  kind: MemoryKind,
  evidence: CanonicalConsequenceEvidence,
  messages: CanonicalConsequenceSourceMessage[],
): boolean {
  if (kind === "fact" || kind === "preference" || kind === "contradiction") {
    return evidence === "direct_user_assertion" && messages.every((message) => message.role === "user");
  }
  if (kind === "promise") return evidence === "explicit_promise" || evidence === "explicit_exchange";
  if (kind === "scene_event" || kind === "plot_state") {
    return evidence === "explicit_screen_event" || evidence === "explicit_exchange";
  }
  if (kind === "relationship_state") {
    return (
      (evidence === "direct_user_assertion" && messages.every((message) => message.role === "user")) ||
      evidence === "explicit_exchange"
    );
  }
  return false;
}

export async function extractCanonicalMemoryConsequences(input: {
  llm: LlmGateway;
  request: CanonicalConsequenceExtractionRequest;
  signal?: AbortSignal;
}): Promise<CanonicalConsequenceExtractionResult> {
  const { request } = input;
  const raw = await input.llm.complete(
    {
      connectionId: request.connectionId,
      model: request.model ?? undefined,
      messages: [
        {
          role: "system",
          content: "You extract durable canonical consequences. Return strict JSON only and never invent evidence.",
        },
        { role: "user", content: consequenceExtractionPrompt(request) },
      ],
      parameters: { temperature: 0, maxTokens: 900 },
    },
    input.signal,
  );
  const parsed = extractJsonObject(raw);
  const rawCandidates = Array.isArray(parsed.memories)
    ? (parsed.memories.filter(isRecord).slice(0, MAX_CAPTURED_MEMORIES) as AutomaticMemoryCandidate[])
    : [];
  const sourceById = new Map(request.sourceMessages.map((message) => [message.id, message]));
  const referenceById = new Map(request.referenceMessages.map((message) => [message.id, message]));
  const eligibleIds = new Set(
    request.eligibleMemories
      .filter(canonicalMemoryEligibleForConsequences)
      .filter((memory) => memory.status === "active")
      .map((memory) => memory.id),
  );
  const candidates: CanonicalMemoryInput[] = [];
  let skippedCount = 0;

  for (const candidate of rawCandidates) {
    const kind = consequenceKind(candidate);
    const content = readString(candidate.content).trim();
    const confidence =
      typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? candidate.confidence
        : Number.NaN;
    const evidence = validConsequenceEvidence(candidate.evidence);
    const evidenceIds = Array.from(new Set(readStringArray(candidate.sourceMessageIds)));
    const referenceIds = Array.from(new Set(readStringArray(candidate.referenceMessageIds)));
    const evidenceMessages = evidenceIds
      .map((id) => sourceById.get(id))
      .filter((message): message is CanonicalConsequenceSourceMessage => message !== undefined);
    const referenceMessages = referenceIds
      .map((id) => referenceById.get(id))
      .filter((message): message is CanonicalConsequenceSourceMessage => message !== undefined);
    const provenanceMessageIds = Array.from(new Set([...evidenceIds, ...referenceIds]));
    const supersedesMemoryId = readString(candidate.supersedesMemoryId).trim() || null;
    if (
      !kind ||
      !content ||
      automaticCaptureMemoryFailure(content) !== null ||
      content.length > MAX_CONSEQUENCE_CONTENT_LENGTH ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !evidence ||
      evidenceIds.length === 0 ||
      evidenceMessages.length !== evidenceIds.length ||
      referenceMessages.length !== referenceIds.length ||
      !evidenceSupportsKind(kind, evidence, evidenceMessages) ||
      !contentSupportedByEvidence(content, evidenceMessages) ||
      !contentSupportedByEvidence(content, [...evidenceMessages, ...referenceMessages]) ||
      !evidencePolarityPreserved(content, evidenceMessages, knownSpeakerTokens(request), referenceMessages) ||
      !namedReportingClausesSupportedByEvidence(content, evidenceMessages, request) ||
      !evidenceSpecificityPreserved(content, evidenceMessages) ||
      (supersedesMemoryId !== null && !eligibleIds.has(supersedesMemoryId))
    ) {
      skippedCount += 1;
      continue;
    }
    const latestEvidence = evidenceMessages
      .map((message) => message.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    candidates.push({
      kind,
      status: confidence >= ACTIVE_CONFIDENCE_THRESHOLD ? "active" : "stale",
      scope: request.scope,
      content,
      confidence,
      provenance: {
        sourceChatId: request.chatId,
        messageIds: provenanceMessageIds,
        characterId: request.activeCharacterId,
        timestamp: latestEvidence || null,
      },
      title: null,
      tags: ["automatic", "consequence", kind],
      supersedesMemoryId,
      payload: {
        automatic: true,
        captureVersion: request.version,
        captureJobId: request.jobId,
        evidence,
        mode: request.mode,
        sourceMessageIds: evidenceIds,
        referenceMessageIds: referenceIds,
      },
    });
  }

  return { candidates, skippedCount };
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const body = fenced || trimmed;
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) return parsed;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(body.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    }
  }
  throw new Error("Automatic memory extraction did not return a JSON object");
}
