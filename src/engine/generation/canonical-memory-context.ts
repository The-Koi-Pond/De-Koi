import {
  getEffectiveMemoryRecallEnabled,
  type GenerationContextAttributionItem,
} from "../contracts/types/chat";
import type { CharacterMemoryPersistence } from "../contracts/types/character";
import type { StorageGateway } from "../capabilities/storage";
import type {
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  MemoryKind,
  MemoryScope,
} from "../contracts/types/memory";
import {
  hiddenFromAi,
  isRecord,
  parseRecord,
  readNumber,
  readString,
  type JsonRecord,
} from "./runtime-records";
import { effectiveCharacterMemoryPersistence } from "./character-memory-scope";

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
}

export interface CanonicalMemoryContextInput {
  chat: JsonRecord;
  storedMessages: JsonRecord[];
  latestUserInput: string;
  characters: CanonicalMemoryCharacterContext[];
  maxContext?: number | null;
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
  return (
    memory.scope.kind === "chat" && memory.scope.id === chatId ||
    memory.provenance.sourceChatId === chatId
  );
}

function sceneScopeMatches(memory: CanonicalMemoryRecord, chat: JsonRecord): boolean {
  const chatId = readString(chat.id).trim();
  const meta = parseRecord(chat.metadata);
  const sceneId =
    readString(meta.sceneChatId).trim() ||
    readString(meta.activeSceneChatId).trim() ||
    (readString(meta.sceneStatus).trim() === "active" ? chatId : "");
  return !!sceneId && (memory.scope.kind === "scene" && memory.scope.id === sceneId || memory.provenance.sceneId === sceneId);
}

function scoreCandidate(
  memory: CanonicalMemoryRecord,
  input: CanonicalMemoryContextInput,
  queryTokens: string[],
  indexSource: MemoryIndexSource,
): CanonicalMemoryCandidate {
  const lexicalScore = lexicalOverlap(queryTokens, memory);
  const lexicalCoverage = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;
  const entityTokens = metadataEntityTokens(input);
  const entityScore = entityTokens.length > 0 ? lexicalOverlap(entityTokens, memory) / entityTokens.length : 0;
  const semanticScore = indexSource === "index" ? 0.18 : 0;
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
    ...(lexicalScore > 0 ? ["keyword_match"] : []),
    ...(entityScore > 0 ? ["entity_match"] : []),
    ...(characterMatch(memory, input.characters) ? ["active_character_match"] : []),
    ...(sceneScopeMatches(memory, input.chat) ? ["scene_scope"] : []),
    ...(chatScopeMatches(memory, input.chat) ? ["chat_scope"] : []),
    ...(memory.status === "pinned" ? ["pinned"] : []),
    ...(importance > 0 ? ["importance"] : []),
  ];
  return { memory, indexSource, lexicalScore, semanticScore, metadataScore, score, reasons };
}

function activeMemory(memory: CanonicalMemoryRecord): boolean {
  return memory.status === "active" || memory.status === "pinned";
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

function scopeQueries(input: CanonicalMemoryContextInput): CanonicalMemoryQuery[] {
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
    .map((scope) => ({ scope }));
}

async function collectMemoryRows(
  storage: StorageGateway,
  input: CanonicalMemoryContextInput,
): Promise<Array<{ memory: CanonicalMemoryRecord; source: MemoryIndexSource }>> {
  const queries = scopeQueries(input);
  const indexed: CanonicalMemoryRecord[] = [];
  if (storage.queryMemoryIndex) {
    for (const query of queries) indexed.push(...(await storage.queryMemoryIndex(query)));
  }
  if (indexed.length > 0) return indexed.map((memory) => ({ memory, source: "index" }));

  const fallback: CanonicalMemoryRecord[] = [];
  if (storage.queryMemories) {
    for (const query of queries) fallback.push(...(await storage.queryMemories(query)));
  } else {
    const rows = await storage.list<unknown>("canonical-memories", { limit: MAX_CANDIDATE_MEMORIES });
    fallback.push(...rows.filter(isRecord).map((row) => row as unknown as CanonicalMemoryRecord));
  }
  return fallback.map((memory) => ({ memory, source: "lexical" }));
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

function sectionForKind(kind: MemoryKind): "durable_facts" | "relationship_state" | "scene_continuity" | "other_memory" {
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

function formatMemoryLine(candidate: CanonicalMemoryCandidate, budgetTokens?: number): string {
  const title = candidate.memory.title?.trim();
  const prefix = title ? `${title}: ` : "";
  const content = budgetTokens ? truncateForTokens(candidate.memory.content.trim(), Math.max(1, budgetTokens - 2)) : candidate.memory.content.trim();
  return `- ${prefix}${content}`;
}

function packCanonicalMemories(candidates: CanonicalMemoryCandidate[], budgetTokens: number) {
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
    const line = formatMemoryLine(candidate, remainingTokens);
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
      metadataScore: candidate.metadataScore,
      score: candidate.score,
      reasons: candidate.reasons,
    },
  };
}

export async function buildCanonicalMemoryContext(
  storage: StorageGateway,
  input: CanonicalMemoryContextInput,
): Promise<CanonicalMemoryPromptContext | null> {
  if (!canonicalMemoryEnabled(input.chat) || !input.latestUserInput.trim()) return null;
  const queryTokens = lexicalTokens(input.latestUserInput);
  if (queryTokens.length === 0) return null;

  const rows = await collectMemoryRows(storage, input);
  const candidates = rows
    .filter((row) => validMemoryRecord(row.memory))
    .map((row) => scoreCandidate(row.memory, input, queryTokens, row.source));
  const consideredCount = candidates.length;
  const ranked = dedupeAndFilterCandidates(candidates, input)
    .filter((candidate) => candidate.indexSource === "index" || candidate.lexicalScore > 0 || candidate.memory.status === "pinned")
    .filter((candidate) => candidate.score >= MIN_CANONICAL_MEMORY_SCORE || candidate.memory.status === "pinned")
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATE_MEMORIES);
  if (ranked.length === 0) return null;

  const packed = packCanonicalMemories(ranked, tokenBudget(input.chat, input.maxContext));
  if (packed.retained.length === 0) return null;
  return {
    block: buildBlock(packed.sections),
    attributionItems: packed.retained.map((candidate, index) =>
      attributionForCandidate(candidate, index, consideredCount),
    ),
    estimatedTokens: packed.estimatedTokens,
    consideredCount,
  };
}
