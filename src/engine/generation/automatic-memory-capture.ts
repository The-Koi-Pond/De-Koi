import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryRecord, MemoryKind, MemoryScope } from "../contracts/types/memory";
import { isRecord, parseRecord, readString } from "./runtime-records";

type AutomaticMemoryCandidate = {
  kind?: unknown;
  content?: unknown;
  confidence?: unknown;
  supersedesMemoryId?: unknown;
  evidence?: unknown;
  sourceMessageIds?: unknown;
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
}

export interface CanonicalConsequenceExtractionRequest {
  version: 1;
  jobId: string;
  chatId: string;
  mode: string;
  scope: MemoryScope;
  activeCharacterId: string | null;
  sourceMessages: CanonicalConsequenceSourceMessage[];
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

const CONSEQUENCE_KINDS = new Set<MemoryKind>([
  "fact",
  "relationship_state",
  "scene_event",
  "preference",
  "promise",
  "plot_state",
  "contradiction",
]);
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

function stableHash(value: string): string {
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
    input.eligibleMemories.filter((memory) => memory.status === "active").map((memory) => [memory.id, memory]),
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
      input.eligibleMemories.find(
        (memory) => readString(parseRecord(memory.payload).semanticIdentity).trim() === semanticIdentity,
      ) ??
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
  const eligible =
    request.eligibleMemories.length > 0
      ? request.eligibleMemories
          .map((memory) => `${memory.id} | ${memory.kind} | ${memory.status} | ${memory.content}`)
          .join("\n")
      : "(none)";
  const exchange = request.sourceMessages
    .map((message) => `${message.id} | ${message.role} | ${message.content}`)
    .join("\n");
  return [
    "Extract only compact, durable consequences from this complete saved De-Koi exchange.",
    'Return JSON only: {"memories":[...]}',
    "Each item must include kind, content, confidence, evidence, and sourceMessageIds.",
    "Allowed kinds: fact, preference, promise, relationship_state, scene_event, plot_state, contradiction.",
    "Allowed evidence: direct_user_assertion, explicit_promise, explicit_screen_event, explicit_exchange.",
    "Do not turn assistant guesses, decorative prose, tentative interpretations, or unsupported inferences into canon.",
    "A fact or preference about the user must cite a direct user assertion.",
    "Use only source message IDs shown below.",
    "Set supersedesMemoryId only to an eligible memory ID shown below; otherwise omit it.",
    `Mode: ${request.mode}`,
    `Scope: ${request.scope.kind}:${request.scope.id}`,
    "Eligible memories:",
    eligible,
    "Saved exchange:",
    exchange,
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

function contentSupportedByEvidence(
  kind: MemoryKind,
  content: string,
  messages: CanonicalConsequenceSourceMessage[],
): boolean {
  const contentTokens = evidenceTokens(content);
  const sourceTokens = evidenceTokens(messages.map((message) => message.content).join(" "));
  const overlap = [...contentTokens].filter((token) => sourceTokens.has(token)).length;
  return overlap >= (kind === "relationship_state" ? 1 : 2);
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
  const eligibleIds = new Set(
    request.eligibleMemories.filter((memory) => memory.status === "active").map((memory) => memory.id),
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
    const evidenceMessages = evidenceIds
      .map((id) => sourceById.get(id))
      .filter((message): message is CanonicalConsequenceSourceMessage => message !== undefined);
    const supersedesMemoryId = readString(candidate.supersedesMemoryId).trim() || null;
    if (
      !kind ||
      !content ||
      content.length > MAX_CONSEQUENCE_CONTENT_LENGTH ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !evidence ||
      evidenceIds.length === 0 ||
      evidenceMessages.length !== evidenceIds.length ||
      !evidenceSupportsKind(kind, evidence, evidenceMessages) ||
      !contentSupportedByEvidence(kind, content, evidenceMessages) ||
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
        messageIds: evidenceIds,
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
