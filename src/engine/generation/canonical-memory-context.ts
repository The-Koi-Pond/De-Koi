import { getEffectiveMemoryRecallEnabled, type GenerationContextAttributionItem } from "../contracts/types/chat";
import type { CharacterMemoryPersistence } from "../contracts/types/character";
import type { StorageGateway } from "../capabilities/storage";
import type {
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  CanonicalMemorySemanticMatch,
  KnowledgeEdge,
  MemoryKind,
  MemoryScope,
} from "../contracts/types/memory";
import { hiddenFromAi, isRecord, parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";
import { effectiveCharacterMemoryPersistence } from "./character-memory-scope";
import { prepareMemoryPromptContent, resolveMemoryUserIdentity } from "./memory-prompt-content";
import {
  formatEpistemicMemory,
  resolveEpistemicAccess,
  type EpistemicAccessResult,
  type EpistemicSubject,
} from "./epistemic-access";
import { loadEpistemicContext } from "./epistemic-context";

type MemoryIndexSource = "index" | "lexical";

interface CanonicalMemoryCharacterContext {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  memoryPersistence?: CharacterMemoryPersistence;
}

interface CanonicalMemoryCandidate {
  memory: CanonicalMemoryRecord;
  indexSource: MemoryIndexSource;
  lexicalScore: number;
  semanticScore: number;
  metadataScore: number;
  score: number;
  reasons: string[];
  retrievalSource: "semantic" | "lexical" | "lexical-fallback" | "pinned";
  semanticEvidence?: Omit<CanonicalMemorySemanticMatch, "memory" | "similarity">;
  semanticFallback?: string;
  epistemicAccess?: EpistemicAccessResult;
}

export interface CanonicalMemoryContextInput {
  chat: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  characters: CanonicalMemoryCharacterContext[];
  personaName?: string | null;
  connectionId?: string | null;
  maxContext?: number | null;
  epistemicSubjects?: EpistemicSubject[];
}

export interface CanonicalMemoryPromptContext {
  block: string;
  attributionItems: GenerationContextAttributionItem[];
  estimatedTokens: number;
  consideredCount: number;
}

const DEFAULT_CANONICAL_MEMORY_BUDGET_TOKENS = 320;
const MIN_CANONICAL_MEMORY_BUDGET_TOKENS = 80;
const MAX_CANONICAL_MEMORY_BUDGET_TOKENS = 900;
const CANONICAL_MEMORY_CONTEXT_SHARE = 0.08;
const DEFAULT_READ_BEHIND_MESSAGES = 1;
const MAX_READ_BEHIND_MESSAGES = 100;
const MAX_SCOPE_CHARACTER_IDS = 8;
const MAX_CANDIDATE_MEMORIES = 60;
const MAX_PROMPT_MEMORIES = 10;
const MIN_CANONICAL_MEMORY_SCORE = 0.12;
const SEMANTIC_SIMILARITY_THRESHOLD = 0.28;
const STRONG_SEMANTIC_RELEVANCE_THRESHOLD = 0.4;
const MIN_LEXICAL_QUERY_COVERAGE = 0.5;
const SEMANTIC_CANDIDATE_LIMIT = 24;

const STOPWORDS = new Set([
  "about",
  "after",
  "and",
  "are",
  "can",
  "did",
  "does",
  "for",
  "from",
  "has",
  "have",
  "her",
  "him",
  "his",
  "how",
  "its",
  "now",
  "our",
  "recall",
  "remember",
  "she",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function canonicalMemoryEnabled(chat: JsonRecord): boolean {
  const metadata = parseRecord(chat.metadata);
  return (
    getEffectiveMemoryRecallEnabled(readString(chat.mode || chat.chatMode), metadata) &&
    metadata.enableCanonicalMemoryRecall !== false
  );
}

function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

function tokenBudget(chat: JsonRecord, maxContext?: number | null): number {
  const meta = parseRecord(chat.metadata);
  const explicit = readNumber(meta.canonicalMemoryRecallTokenBudget, 0);
  const target = explicit > 0 ? explicit : maxContext ? Math.floor(maxContext * CANONICAL_MEMORY_CONTEXT_SHARE) : 0;
  return Math.max(
    MIN_CANONICAL_MEMORY_BUDGET_TOKENS,
    Math.min(MAX_CANONICAL_MEMORY_BUDGET_TOKENS, target || DEFAULT_CANONICAL_MEMORY_BUDGET_TOKENS),
  );
}

function lexicalTokens(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/[\p{Letter}\p{Number}]{2,}/gu), (match) => match[0]).filter(
    (token) => !STOPWORDS.has(token),
  );
}

function tokenSet(text: string): Set<string> {
  return new Set(lexicalTokens(text));
}

function lexicalOverlap(queryTokens: string[], memory: CanonicalMemoryRecord): number {
  const haystack = tokenSet(
    [
      memory.content,
      memory.title ?? "",
      ...memory.tags,
      readString(parseRecord(memory.payload).category),
      readString(memory.kind),
    ].join(" "),
  );
  return queryTokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
}

function metadataEntityTokens(input: CanonicalMemoryContextInput): string[] {
  const chatMeta = parseRecord(input.chat.metadata);
  const pieces = [
    readString(input.chat.name),
    readString(chatMeta.sceneName),
    readString(chatMeta.sceneTitle),
    ...input.characters.flatMap((character) => [character.id, character.name, ...character.tags]),
  ];
  return lexicalTokens(pieces.join(" "));
}

function recencyScore(memory: CanonicalMemoryRecord): number {
  const timestamp = Date.parse(memory.provenance.timestamp || memory.updatedAt || memory.createdAt);
  if (!Number.isFinite(timestamp)) return 0;
  const now = Date.now();
  if (timestamp >= now) return 0.1;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.max(0, 0.12 - Math.min(0.12, ageDays * 0.004));
}

function payloadNumber(memory: CanonicalMemoryRecord, key: string): number {
  const value = parseRecord(memory.payload)[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function characterMatch(memory: CanonicalMemoryRecord, characters: CanonicalMemoryCharacterContext[]): boolean {
  const characterIds = new Set(characters.map((character) => character.id).filter(Boolean));
  return (
    (!!memory.provenance.characterId && characterIds.has(memory.provenance.characterId)) ||
    (memory.scope.kind === "character" && characterIds.has(memory.scope.id))
  );
}

function chatScopeMatches(memory: CanonicalMemoryRecord, chat: JsonRecord): boolean {
  const chatId = readString(chat.id).trim();
  return (memory.scope.kind === "chat" && memory.scope.id === chatId) || memory.provenance.sourceChatId === chatId;
}

function sceneScopeMatches(memory: CanonicalMemoryRecord, chat: JsonRecord): boolean {
  const chatId = readString(chat.id).trim();
  const meta = parseRecord(chat.metadata);
  const sceneId =
    readString(meta.sceneChatId).trim() ||
    readString(meta.activeSceneChatId).trim() ||
    (readString(meta.sceneStatus).trim() === "active" ? chatId : "");
  return (
    !!sceneId &&
    ((memory.scope.kind === "scene" && memory.scope.id === sceneId) || memory.provenance.sceneId === sceneId)
  );
}

function scoreCandidate(
  memory: CanonicalMemoryRecord,
  input: CanonicalMemoryContextInput,
  queryTokens: string[],
  indexSource: MemoryIndexSource,
  semanticMatch?: CanonicalMemorySemanticMatch,
  semanticFallback?: string,
): CanonicalMemoryCandidate {
  const lexicalScore = lexicalOverlap(queryTokens, memory);
  const lexicalCoverage = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;
  const entityTokens = metadataEntityTokens(input);
  const entityScore = entityTokens.length > 0 ? lexicalOverlap(entityTokens, memory) / entityTokens.length : 0;
  const semanticScore =
    semanticMatch && Number.isFinite(semanticMatch.similarity) ? Math.max(0, Math.min(1, semanticMatch.similarity)) : 0;
  const importance = payloadNumber(memory, "importance");
  const metadataScore =
    Math.min(0.18, lexicalCoverage * 0.18) +
    Math.min(0.12, entityScore * 0.12) +
    (characterMatch(memory, input.characters) ? 0.12 : 0) +
    (sceneScopeMatches(memory, input.chat) ? 0.1 : 0) +
    (chatScopeMatches(memory, input.chat) ? 0.05 : 0) +
    (memory.status === "pinned" ? 0.16 : 0) +
    Math.min(0.12, memory.confidence * 0.12) +
    Math.min(0.1, importance * 0.1) +
    recencyScore(memory);
  const score = semanticScore + metadataScore;
  const reasons = [
    ...(indexSource === "index" ? ["index_candidate"] : ["lexical_fallback"]),
    ...(semanticScore >= SEMANTIC_SIMILARITY_THRESHOLD ? ["semantic_match"] : []),
    ...(semanticFallback ? ["semantic_unavailable"] : []),
    ...(lexicalScore > 0 ? ["keyword_match"] : []),
    ...(entityScore > 0 ? ["entity_match"] : []),
    ...(characterMatch(memory, input.characters) ? ["active_character_match"] : []),
    ...(sceneScopeMatches(memory, input.chat) ? ["scene_scope"] : []),
    ...(chatScopeMatches(memory, input.chat) ? ["chat_scope"] : []),
    ...(memory.status === "pinned" ? ["pinned"] : []),
    ...(importance > 0 ? ["importance"] : []),
  ];
  const retrievalSource =
    semanticScore >= SEMANTIC_SIMILARITY_THRESHOLD
      ? "semantic"
      : semanticFallback
        ? "lexical-fallback"
        : memory.status === "pinned"
          ? "pinned"
          : "lexical";
  return {
    memory,
    indexSource,
    lexicalScore,
    semanticScore,
    metadataScore,
    score,
    reasons,
    retrievalSource,
    ...(semanticMatch
      ? {
          semanticEvidence: {
            connectionId: semanticMatch.connectionId,
            provider: semanticMatch.provider,
            model: semanticMatch.model,
          },
        }
      : {}),
    ...(semanticFallback ? { semanticFallback } : {}),
  };
}

function activeMemory(memory: CanonicalMemoryRecord): boolean {
  return memory.status === "active" || memory.status === "pinned";
}

function relevantEnoughForPrompt(
  candidate: CanonicalMemoryCandidate,
  input: CanonicalMemoryContextInput,
  queryTokenCount: number,
): boolean {
  if (candidate.memory.status === "pinned") return true;
  if (
    (chatScopeMatches(candidate.memory, input.chat) || sceneScopeMatches(candidate.memory, input.chat)) &&
    (candidate.lexicalScore > 0 || candidate.semanticScore >= SEMANTIC_SIMILARITY_THRESHOLD)
  ) {
    return true;
  }
  if (candidate.semanticScore >= STRONG_SEMANTIC_RELEVANCE_THRESHOLD) return true;
  if (candidate.lexicalScore <= 0 || queryTokenCount <= 0) return false;
  return candidate.lexicalScore / queryTokenCount >= MIN_LEXICAL_QUERY_COVERAGE;
}

function recentMessageIds(chat: JsonRecord, storedMessages: JsonRecord[]): Set<string> {
  const raw = readNumber(parseRecord(chat.metadata).memoryRecallReadBehindMessages, DEFAULT_READ_BEHIND_MESSAGES);
  const readBehind = Math.max(0, Math.min(MAX_READ_BEHIND_MESSAGES, Math.trunc(raw)));
  if (readBehind <= 0) return new Set();
  const visible = storedMessages.filter((message) => !hiddenFromAi(message) && readString(message.content).trim());
  return new Set(
    visible
      .slice(-readBehind)
      .map((message) => readString(message.id).trim())
      .filter(Boolean),
  );
}

function overlapsRecentMessages(memory: CanonicalMemoryRecord, recentIds: Set<string>): boolean {
  if (recentIds.size === 0) return false;
  return memory.provenance.messageIds.some((messageId) => recentIds.has(messageId));
}

function dedupeAndFilterCandidates(
  candidates: CanonicalMemoryCandidate[],
  input: CanonicalMemoryContextInput,
): CanonicalMemoryCandidate[] {
  const recentIds = recentMessageIds(input.chat, input.storedMessages);
  const byId = new Map<string, CanonicalMemoryCandidate>();
  for (const candidate of candidates) {
    if (!activeMemory(candidate.memory)) continue;
    if (candidate.memory.supersededByMemoryId) continue;
    if (overlapsRecentMessages(candidate.memory, recentIds)) continue;
    const existing = byId.get(candidate.memory.id);
    if (!existing || candidate.score > existing.score) byId.set(candidate.memory.id, candidate);
  }
  const activeSupersededIds = new Set(
    Array.from(byId.values())
      .map((candidate) => candidate.memory.supersedesMemoryId)
      .filter((id): id is string => !!id),
  );
  return Array.from(byId.values()).filter((candidate) => !activeSupersededIds.has(candidate.memory.id));
}

function scopeQueries(input: CanonicalMemoryContextInput, epistemicPolicy: boolean): CanonicalMemoryQuery[] {
  const chatId = readString(input.chat.id).trim();
  const meta = parseRecord(input.chat.metadata);
  const sceneId =
    readString(meta.sceneChatId).trim() ||
    readString(meta.activeSceneChatId).trim() ||
    (readString(meta.sceneStatus).trim() === "active" ? chatId : "");
  const scopes: MemoryScope[] = [];
  if (chatId) scopes.push({ kind: "chat", id: chatId });
  if (sceneId) scopes.push({ kind: "scene", id: sceneId });
  for (const character of input.characters.slice(0, MAX_SCOPE_CHARACTER_IDS)) {
    if (character.id && effectiveCharacterMemoryPersistence(character.memoryPersistence) === "character") {
      scopes.push({ kind: "character", id: character.id });
    }
  }
  const seen = new Set<string>();
  return scopes
    .filter((scope) => {
      const key = `${scope.kind}:${scope.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((scope) => ({ scope, ...(epistemicPolicy ? { epistemicPolicyVersion: 1 as const } : {}) }));
}

async function collectMemoryRows(
  storage: StorageGateway,
  queries: CanonicalMemoryQuery[],
): Promise<Array<{ memory: CanonicalMemoryRecord; source: MemoryIndexSource }>> {
  const scopeOrdinal = new Map(
    queries.map((query, index) => {
      const scope = query.scope;
      return [scope ? `${scope.kind}:${scope.id}` : "", index] as const;
    }),
  );
  const orderedBatchRows = (rows: CanonicalMemoryRecord[]) =>
    rows
      .flatMap((memory, index) => {
        const ordinal = scopeOrdinal.get(`${memory.scope.kind}:${memory.scope.id}`);
        return ordinal === undefined ? [] : [{ memory, index, ordinal }];
      })
      .sort((left, right) => left.ordinal - right.ordinal || left.index - right.index)
      .map(({ memory }) => memory);
  const indexed: CanonicalMemoryRecord[] = [];
  if (storage.queryMemoryIndexBatch) {
    indexed.push(...orderedBatchRows(await storage.queryMemoryIndexBatch(queries)));
  } else if (storage.queryMemoryIndex) {
    for (const query of queries) indexed.push(...(await storage.queryMemoryIndex(query)));
  }
  let lexicalIndexComplete: boolean | null = null;
  if (storage.memoryIndexHealth) {
    try {
      const health = await storage.memoryIndexHealth();
      lexicalIndexComplete = health.lexicalComplete;
      if (health.lexicalComplete) {
        return indexed.map((memory) => ({ memory, source: "index" as const }));
      }
    } catch {
      // Unknown health must retain the durable fallback for compatibility and correctness.
    }
  }
  const fallback: CanonicalMemoryRecord[] = [];
  try {
    if (storage.queryMemoriesBatch) {
      fallback.push(...orderedBatchRows(await storage.queryMemoriesBatch(queries)));
    } else if (storage.queryMemories) {
      for (const query of queries) fallback.push(...(await storage.queryMemories(query)));
    } else if (indexed.length === 0) {
      const rows = await storage.list<unknown>("canonical-memories", { limit: MAX_CANDIDATE_MEMORIES });
      fallback.push(...rows.filter(isRecord).map((row) => row as unknown as CanonicalMemoryRecord));
    }
  } catch (error) {
    // The durable query supplements the index so partial indexes can self-heal.
    // Keep valid index recall available if that supplemental read is temporarily
    // unavailable; without any index result there is no safe recall to return.
    if (indexed.length === 0) throw error;
  }

  if (lexicalIndexComplete === false && storage.rebuildMemoryIndex) {
    void storage.rebuildMemoryIndex().catch(() => undefined);
  }

  const seen = new Set(indexed.map((memory) => memory.id));
  return [
    ...indexed.map((memory) => ({ memory, source: "index" as const })),
    ...fallback.filter((memory) => !seen.has(memory.id)).map((memory) => ({ memory, source: "lexical" as const })),
  ];
}

function validMemoryRecord(value: CanonicalMemoryRecord): boolean {
  return (
    !!value &&
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.kind === "string" &&
    !!value.scope &&
    typeof value.scope.kind === "string" &&
    typeof value.scope.id === "string" &&
    !!value.provenance &&
    Array.isArray(value.provenance.messageIds)
  );
}

function sectionForKind(
  kind: MemoryKind,
): "durable_facts" | "relationship_state" | "scene_continuity" | "other_memory" {
  if (kind === "fact" || kind === "preference" || kind === "promise" || kind === "lore") return "durable_facts";
  if (kind === "relationship_state") return "relationship_state";
  if (kind === "scene_event" || kind === "plot_state" || kind === "episode" || kind === "summary") {
    return "scene_continuity";
  }
  return "other_memory";
}

function truncateForTokens(text: string, budgetTokens: number): string {
  const maxChars = Math.max(24, budgetTokens * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 4)).trimEnd()}...`;
}

function formatMemoryLine(
  candidate: CanonicalMemoryCandidate,
  budgetTokens?: number,
  personaName?: string | null,
): string | null {
  const title = candidate.memory.title?.trim();
  const prefix = title ? `${title}: ` : "";
  const promptContent = prepareMemoryPromptContent(resolveMemoryUserIdentity(candidate.memory.content, personaName));
  if (!promptContent) return null;
  const framedContent = candidate.epistemicAccess?.classified
    ? formatEpistemicMemory(promptContent, candidate.epistemicAccess.decisions)
    : promptContent;
  const content = budgetTokens ? truncateForTokens(framedContent, Math.max(1, budgetTokens - 2)) : framedContent;
  return `- ${prefix}${content}`;
}

function packCanonicalMemories(
  candidates: CanonicalMemoryCandidate[],
  budgetTokens: number,
  personaName?: string | null,
) {
  const sections: Record<ReturnType<typeof sectionForKind>, string[]> = {
    durable_facts: [],
    relationship_state: [],
    scene_continuity: [],
    other_memory: [],
  };
  const retained: CanonicalMemoryCandidate[] = [];
  let estimatedTokens = estimateTextTokens("<canonical_memories></canonical_memories>");
  for (const candidate of candidates) {
    if (retained.length >= MAX_PROMPT_MEMORIES) break;
    const remainingTokens = budgetTokens - estimatedTokens - 4;
    if (remainingTokens < 12) break;
    const line = formatMemoryLine(candidate, remainingTokens, personaName);
    if (!line) continue;
    const lineTokens = estimateTextTokens(line) + 4;
    if (estimatedTokens + lineTokens > budgetTokens) break;
    sections[sectionForKind(candidate.memory.kind)].push(line);
    retained.push(candidate);
    estimatedTokens += lineTokens;
  }
  return { sections, retained, estimatedTokens };
}

function buildBlock(sections: Record<ReturnType<typeof sectionForKind>, string[]>): string {
  const lines = [
    "<canonical_memories>",
    "Use these canonical durable memories as compact continuity context. They are separate from transcript recall and should not be named as memory retrieval.",
  ];
  for (const [section, values] of Object.entries(sections)) {
    if (values.length === 0) continue;
    lines.push(`<${section}>`, ...values, `</${section}>`);
  }
  lines.push("</canonical_memories>");
  return lines.join("\n");
}

function attributionForCandidate(
  candidate: CanonicalMemoryCandidate,
  index: number,
  consideredCount: number,
): GenerationContextAttributionItem {
  return {
    kind: "memory_recall",
    label: `Canonical memory ${index + 1}`,
    status: "injected",
    sourceId: candidate.memory.id,
    sourceCollection: "canonical-memories",
    snippet: candidate.memory.content,
    metadata: {
      source: "canonical_memory",
      rank: index + 1,
      consideredCount,
      indexSource: candidate.indexSource,
      memoryKind: candidate.memory.kind,
      memoryStatus: candidate.memory.status,
      scope: candidate.memory.scope,
      confidence: candidate.memory.confidence,
      lexicalScore: candidate.lexicalScore,
      semanticScore: candidate.semanticScore,
      retrievalSource: candidate.retrievalSource,
      semanticProvider: candidate.semanticEvidence?.provider,
      semanticModel: candidate.semanticEvidence?.model,
      semanticConnectionId: candidate.semanticEvidence?.connectionId,
      semanticFallback: candidate.semanticFallback,
      metadataScore: candidate.metadataScore,
      score: candidate.score,
      reasons: candidate.reasons,
      epistemicPolicyVersion: candidate.epistemicAccess ? 1 : undefined,
      epistemicReason: candidate.epistemicAccess?.reason,
      epistemicClassified: candidate.epistemicAccess?.classified,
      epistemicEdgeIds: candidate.epistemicAccess?.edgeIds,
      epistemicDecisions: candidate.epistemicAccess?.decisions,
    },
  };
}

function excludedAttribution(
  candidate: CanonicalMemoryCandidate,
  consideredCount: number,
): GenerationContextAttributionItem {
  return {
    kind: "memory_recall",
    label: "Canonical memory excluded",
    status: "skipped",
    sourceId: candidate.memory.id,
    sourceCollection: "canonical-memories",
    snippet: candidate.memory.content,
    metadata: {
      source: "canonical_memory",
      consideredCount,
      epistemicPolicyVersion: 1,
      epistemicReason: candidate.epistemicAccess?.reason ?? "missing_edge",
      epistemicClassified: candidate.epistemicAccess?.classified ?? true,
      epistemicEdgeIds: candidate.epistemicAccess?.edgeIds ?? [],
      epistemicDecisions: candidate.epistemicAccess?.decisions ?? [],
    },
  };
}

function epistemicSubjects(input: CanonicalMemoryContextInput): EpistemicSubject[] {
  return (
    input.epistemicSubjects ??
    input.characters.map((character) => ({ kind: "character" as const, id: character.id, name: character.name }))
  ).filter((subject) => subject.id.trim());
}

function semanticFallbackCode(error: unknown): string {
  if (isRecord(error)) {
    const code = readString(error.code).trim();
    if (code) return code.slice(0, 80);
    if (isRecord(error.details)) {
      const detailsCode = readString(error.details.code).trim();
      if (detailsCode) return detailsCode.slice(0, 80);
    }
  }
  return "unavailable";
}

export async function buildCanonicalMemoryContext(
  storage: StorageGateway,
  input: CanonicalMemoryContextInput,
): Promise<CanonicalMemoryPromptContext | null> {
  if (!canonicalMemoryEnabled(input.chat) || !input.latestUserInput.trim()) return null;
  const queryTokens = lexicalTokens(input.latestUserInput);
  const connectionId = readString(input.connectionId).trim();
  const semanticQuery = storage.querySemanticMemories;
  if (queryTokens.length === 0 && (!semanticQuery || !connectionId)) return null;

  const epistemic = await loadEpistemicContext(storage, epistemicSubjects(input));
  const queries = scopeQueries(input, epistemic.enabled);
  const semanticResultPromise =
    semanticQuery && connectionId
      ? semanticQuery({
          queryText: input.latestUserInput,
          queries,
          connectionId,
          limit: SEMANTIC_CANDIDATE_LIMIT,
          similarityThreshold: SEMANTIC_SIMILARITY_THRESHOLD,
          ...(epistemic.enabled ? { epistemicPolicyVersion: 1 as const } : {}),
        })
          .then((matches) => ({ matches, fallback: undefined as string | undefined }))
          .catch((error: unknown) => ({
            matches: [] as CanonicalMemorySemanticMatch[],
            fallback: semanticFallbackCode(error),
          }))
      : Promise.resolve({ matches: [] as CanonicalMemorySemanticMatch[], fallback: undefined as string | undefined });
  const [collectedRows, semanticResult] = await Promise.all([
    collectMemoryRows(storage, queries),
    semanticResultPromise,
  ]);
  const epistemicSupersededIds = new Set(
    epistemic.holderEdges
      .filter((edge) => edge.status === "active" && edge.stance !== "unknown")
      .map((edge) => edge.memoryId),
  );
  if (epistemic.enabled && storage.queryMemories && epistemicSupersededIds.size > 0) {
    const existingIds = new Set(collectedRows.map((row) => row.memory.id));
    const missingIds = Array.from(epistemicSupersededIds).filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const beliefs = await storage.queryMemories({
        memoryIds: missingIds,
        statuses: ["superseded"],
        epistemicPolicyVersion: 1,
      });
      collectedRows.push(...beliefs.map((memory) => ({ memory, source: "lexical" as const })));
    }
  }
  const allowedScopeKeys = new Set(
    queries.map((query) => (query.scope ? `${query.scope.kind}:${query.scope.id}` : "")),
  );
  const semanticById = new Map(
    semanticResult.matches
      .filter(
        (match) =>
          validMemoryRecord(match.memory) &&
          allowedScopeKeys.has(`${match.memory.scope.kind}:${match.memory.scope.id}`) &&
          Number.isFinite(match.similarity),
      )
      .map((match) => [match.memory.id, match] as const),
  );
  const rows = [...collectedRows];
  const collectedIds = new Set(rows.map((row) => row.memory.id));
  for (const match of semanticById.values()) {
    if (!collectedIds.has(match.memory.id)) rows.push({ memory: match.memory, source: "index" });
  }
  const candidates = rows
    .filter((row) => validMemoryRecord(row.memory))
    .map((row) =>
      scoreCandidate(
        row.memory,
        input,
        queryTokens,
        row.source,
        semanticById.get(row.memory.id),
        semanticResult.fallback,
      ),
    );
  const consideredCount = candidates.length;
  const ordinaryRanked = dedupeAndFilterCandidates(candidates, input);
  const supersededBeliefs = candidates.filter(
    (candidate) =>
      candidate.memory.status === "superseded" &&
      epistemicSupersededIds.has(candidate.memory.id) &&
      !overlapsRecentMessages(candidate.memory, recentMessageIds(input.chat, input.storedMessages)),
  );
  const rankedById = new Map<string, CanonicalMemoryCandidate>();
  for (const candidate of [...ordinaryRanked, ...supersededBeliefs]) {
    const existing = rankedById.get(candidate.memory.id);
    if (!existing || candidate.score > existing.score) rankedById.set(candidate.memory.id, candidate);
  }
  let ranked = Array.from(rankedById.values())
    .filter((candidate) => relevantEnoughForPrompt(candidate, input, queryTokens.length))
    .filter((candidate) => candidate.score >= MIN_CANONICAL_MEMORY_SCORE || candidate.memory.status === "pinned")
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATE_MEMORIES);
  if (ranked.length === 0) return null;

  let excluded: CanonicalMemoryCandidate[] = [];
  if (epistemic.enabled && storage.queryKnowledgeEdges) {
    let edges: KnowledgeEdge[];
    try {
      edges = await storage.queryKnowledgeEdges({ memoryIds: ranked.map((candidate) => candidate.memory.id) });
    } catch {
      ranked = ranked.map((candidate) => ({
        ...candidate,
        epistemicAccess: {
          admitted: false,
          classified: true,
          reason: "epistemic_unavailable",
          decisions: [],
          edgeIds: [],
        },
      }));
      excluded = ranked;
      ranked = [];
      edges = [];
    }
    if (ranked.length > 0) {
      ranked = ranked.map((candidate) => ({
        ...candidate,
        epistemicAccess: resolveEpistemicAccess({
          memoryId: candidate.memory.id,
          edges,
          subjects: epistemic.subjects,
          groups: epistemic.groups,
        }),
      }));
      excluded = ranked.filter((candidate) => candidate.epistemicAccess?.admitted === false);
      ranked = ranked.filter((candidate) => candidate.epistemicAccess?.admitted !== false);
    }
  }

  const packed = packCanonicalMemories(ranked, tokenBudget(input.chat, input.maxContext), input.personaName);
  if (packed.retained.length === 0 && excluded.length === 0) return null;
  return {
    block: packed.retained.length > 0 ? buildBlock(packed.sections) : "",
    attributionItems: [
      ...packed.retained.map((candidate, index) => attributionForCandidate(candidate, index, consideredCount)),
      ...excluded.map((candidate) => excludedAttribution(candidate, consideredCount)),
    ],
    estimatedTokens: packed.estimatedTokens,
    consideredCount,
  };
}
