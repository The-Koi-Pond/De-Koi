export type MemoryRecallEvaluationMode =
  | "vector_only"
  | "lexical_fallback"
  | "hybrid"
  | "hybrid_without_stale_superseded_filtering";

export interface MemoryRecallEvaluationTurn {
  id: string;
  role: "user" | "assistant";
  speaker: string;
  content: string;
}

export interface MemoryRecallEvaluationMemory {
  id: string;
  content: string;
  embedding?: number[] | null;
  status?: "active" | "deleted" | "wrong" | "superseded" | string;
  deletedAt?: string | null;
  correctedAt?: string | null;
  supersededAt?: string | null;
  supersededByMemoryId?: string | null;
  pinned?: boolean;
  migratedCanonical?: boolean;
}

export interface MemoryRecallEvaluationCase {
  id: string;
  question: string;
  memories: MemoryRecallEvaluationMemory[];
  expectedMemoryIds: string[];
  wrongMemoryIds?: string[];
  staleSupersededMemoryIds?: string[];
  extractionFailed?: boolean;
  userCorrection?: boolean;
  migrationCorrectness?: boolean;
}

export interface MemoryRecallEvaluationFixture {
  turns: MemoryRecallEvaluationTurn[];
  memories: MemoryRecallEvaluationMemory[];
  cases: MemoryRecallEvaluationCase[];
  coverage: {
    recallQuestions: boolean;
    contradictionsAndSupersession: boolean;
    timeSkips: boolean;
    relationshipChanges: boolean;
    messageEditsAndDeletes: boolean;
    branchyScenes: boolean;
    multipleParticipants: boolean;
    migrationCorrectness: boolean;
    userCorrectionBehavior: boolean;
  };
}

export interface MemoryRecallEvaluationCaseResult {
  id: string;
  recalledIds: string[];
  correctRecall: number;
  wrongRecall: number;
  missingRecall: number;
  staleSupersededRecall: number;
  tokenCost: number;
}

export interface MemoryRecallEvaluationResult {
  mode: MemoryRecallEvaluationMode;
  cases: MemoryRecallEvaluationCaseResult[];
  totals: {
    correctRecall: number;
    wrongRecall: number;
    missingRecall: number;
    staleSupersededRecall: number;
    tokenCost: number;
    extractionFailures: number;
    userCorrectionCases: number;
    migrationCorrectnessCases: number;
  };
}

const MEMORY_EMBEDDING_DIMS = 512;
const MEMORY_RECALL_SIMILARITY_THRESHOLD = 0.28;
const MIN_STRONG_LEXICAL_TOKENS = 2;
const MIN_STRONG_LEXICAL_COVERAGE = 0.66;
const MAX_RECALLED_MEMORIES = 8;
const EVALUATION_STOPWORDS = new Set([
  "about",
  "and",
  "are",
  "did",
  "does",
  "for",
  "from",
  "her",
  "him",
  "his",
  "how",
  "into",
  "is",
  "its",
  "know",
  "now",
  "our",
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

export const recommendedMemoryRecallDefaults = {
  defaultBudgetTokens: 768,
  minBudgetTokens: 256,
  maxBudgetTokens: 1536,
  contextShare: 0.1,
  similarityThreshold: MEMORY_RECALL_SIMILARITY_THRESHOLD,
  readBehindMessages: 1,
  maxScoringChunks: 500,
  staleFiltering: true,
  lexicalFallback: true,
} as const;

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

function tokens(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/[\p{Letter}\p{Number}]{2,}/gu), (match) => match[0]);
}

function meaningfulTokens(text: string): string[] {
  return Array.from(new Set(tokens(text).filter((token) => !EVALUATION_STOPWORDS.has(token))));
}

function hashFeature(feature: string): number {
  let hash = 2166136261;
  for (const char of Array.from(feature)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = hashFeature(feature);
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[hash % MEMORY_EMBEDDING_DIMS] += weight * sign;
}

export function memoryRecallEvaluationEmbedding(text: string): number[] {
  const vector = Array.from({ length: MEMORY_EMBEDDING_DIMS }, () => 0);
  const words = meaningfulTokens(text);
  for (const token of words) {
    addFeature(vector, `w:${token}`, 1);
    if (token.length >= 5) addFeature(vector, `p:${token.slice(0, 4)}`, 0.25);
  }
  for (let index = 0; index + 1 < words.length; index += 1) {
    addFeature(vector, `b:${words[index]} ${words[index + 1]}`, 1.4);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMag += a * a;
    rightMag += b * b;
  }
  const denom = Math.sqrt(leftMag) * Math.sqrt(rightMag);
  return denom > 0 ? dot / denom : 0;
}

function lexicalOverlap(queryTokens: string[], content: string): number {
  const contentTokens = new Set(tokens(content));
  return queryTokens.reduce((count, token) => count + (contentTokens.has(token) ? 1 : 0), 0);
}

function hasStrongLexicalMatch(queryTokenCount: number, lexicalScore: number): boolean {
  if (queryTokenCount === 1) return lexicalScore >= 1;
  if (queryTokenCount < MIN_STRONG_LEXICAL_TOKENS) return false;
  if (lexicalScore < MIN_STRONG_LEXICAL_TOKENS) return false;
  return lexicalScore / queryTokenCount >= MIN_STRONG_LEXICAL_COVERAGE;
}

function isActive(memory: MemoryRecallEvaluationMemory): boolean {
  return (memory.status ?? "active") === "active" && !memory.deletedAt && !memory.correctedAt;
}

function isNotStale(memory: MemoryRecallEvaluationMemory): boolean {
  return !memory.supersededAt && !memory.supersededByMemoryId && memory.status !== "superseded";
}

function shouldConsider(memory: MemoryRecallEvaluationMemory, mode: MemoryRecallEvaluationMode): boolean {
  if (!isActive(memory)) return false;
  if (mode !== "hybrid_without_stale_superseded_filtering" && !isNotStale(memory)) return false;
  return true;
}

function scoreMemory(
  memory: MemoryRecallEvaluationMemory,
  query: string,
  mode: MemoryRecallEvaluationMode,
): { id: string; score: number; tokens: number } | null {
  if (!shouldConsider(memory, mode)) return null;
  const queryTokens = meaningfulTokens(query);
  const lexicalScore = lexicalOverlap(queryTokens, memory.content);
  let score = 0;

  if (mode === "lexical_fallback") {
    score = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;
  } else {
    const queryVector = memoryRecallEvaluationEmbedding(query);
    const vector =
      Array.isArray(memory.embedding) && memory.embedding.length === MEMORY_EMBEDDING_DIMS
        ? memory.embedding
        : mode === "vector_only"
          ? null
          : memoryRecallEvaluationEmbedding(memory.content);
    if (!vector) return null;
    score = cosineSimilarity(queryVector, vector);
    if (mode === "hybrid" || mode === "hybrid_without_stale_superseded_filtering") {
      score += Math.min(0.2, lexicalScore * 0.025);
      if (memory.pinned) score += 0.15;
    }
  }

  const passes = score >= MEMORY_RECALL_SIMILARITY_THRESHOLD || hasStrongLexicalMatch(queryTokens.length, lexicalScore);
  return passes ? { id: memory.id, score, tokens: estimateTokens(memory.content) } : null;
}

export function evaluateMemoryRecallCases(
  cases: MemoryRecallEvaluationCase[],
  options: { mode: MemoryRecallEvaluationMode },
): MemoryRecallEvaluationResult {
  const caseResults = cases.map((testCase) => {
    const recalled = testCase.memories
      .map((memory) => scoreMemory(memory, testCase.question, options.mode))
      .filter((item): item is { id: string; score: number; tokens: number } => !!item)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RECALLED_MEMORIES);
    const recalledIds = recalled.map((item) => item.id);
    const expected = new Set(testCase.expectedMemoryIds);
    const wrong = new Set(testCase.wrongMemoryIds ?? []);
    const stale = new Set(testCase.staleSupersededMemoryIds ?? []);
    const correctRecall = recalledIds.filter((id) => expected.has(id)).length;
    const wrongRecall = recalledIds.filter((id) => wrong.has(id)).length;
    const staleSupersededRecall = recalledIds.filter((id) => stale.has(id)).length;
    const missingRecall = testCase.expectedMemoryIds.filter((id) => !recalledIds.includes(id)).length;
    const tokenCost = recalled.reduce((sum, item) => sum + item.tokens, 0);
    return {
      id: testCase.id,
      recalledIds,
      correctRecall,
      wrongRecall,
      missingRecall,
      staleSupersededRecall,
      tokenCost,
    };
  });

  const totals = caseResults.reduce(
    (acc, result, index) => {
      const testCase = cases[index];
      acc.correctRecall += result.correctRecall;
      acc.wrongRecall += result.wrongRecall;
      acc.missingRecall += result.missingRecall;
      acc.staleSupersededRecall += result.staleSupersededRecall;
      acc.tokenCost += result.tokenCost;
      if (testCase?.extractionFailed) acc.extractionFailures += 1;
      if (testCase?.userCorrection) acc.userCorrectionCases += 1;
      if (testCase?.migrationCorrectness) acc.migrationCorrectnessCases += 1;
      return acc;
    },
    {
      correctRecall: 0,
      wrongRecall: 0,
      missingRecall: 0,
      staleSupersededRecall: 0,
      tokenCost: 0,
      extractionFailures: 0,
      userCorrectionCases: 0,
      migrationCorrectnessCases: 0,
    },
  );

  return { mode: options.mode, cases: caseResults, totals };
}

function memory(id: string, content: string, options: Partial<MemoryRecallEvaluationMemory> = {}): MemoryRecallEvaluationMemory {
  return {
    id,
    content,
    embedding: options.embedding === undefined ? memoryRecallEvaluationEmbedding(content) : options.embedding,
    status: "active",
    ...options,
  };
}

function buildTurns(): MemoryRecallEvaluationTurn[] {
  const beats = [
    "The lantern key is hidden beneath the blue lantern.",
    "Mira promises to guard the archive gate.",
    "Sable joins the scene and borrows the brass compass.",
    "A branch opens toward the moon bridge instead of the pier.",
    "The fox mask rumor points beneath the pier.",
    "Three weeks pass before everyone reaches the cedar house.",
    "Mira admits she trusts the user as her partner now.",
    "An edited note moves the map from the west stair to the east stair.",
    "A deleted aside about the silver key is no longer canon.",
    "The fox mask is corrected to the cedar cabinet.",
  ];
  return Array.from({ length: 56 }, (_, index) => ({
    id: `turn-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    speaker: index % 3 === 0 ? "User" : index % 3 === 1 ? "Mira" : "Sable",
    content: `${beats[index % beats.length]} Scene beat ${index + 1}.`,
  }));
}

export function buildLongRoleplayMemoryEvaluationFixture(): MemoryRecallEvaluationFixture {
  const memories = [
    memory("lantern-key", "The user hid the archive key beneath the blue lantern."),
    memory("mira-trust", "Mira now treats the user as a trusted partner after the cedar house confrontation."),
    memory("time-skip", "Three weeks passed between the moon bridge scene and the cedar house arrival."),
    memory("sable-compass", "Sable borrowed the brass compass and still owes it back to Mira."),
    memory("branch-moon-bridge", "The active branch followed the moon bridge path, not the pier route."),
    memory("edited-map", "After the message edit, the vault map is on the east stair.", { embedding: null }),
    memory("deleted-silver-key", "The silver key under the fountain was deleted and must not be treated as canon.", {
      status: "deleted",
    }),
    memory("old-fox-mask", "Mira believes the fox mask is hidden beneath the pier.", {
      supersededAt: "2026-01-02T00:00:00.000Z",
      supersededByMemoryId: "new-fox-mask",
    }),
    memory("new-fox-mask", "Mira knows the fox mask is locked in the cedar cabinet.", {
      embedding: null,
      migratedCanonical: true,
    }),
    memory("migrated-summary", "Migrated summary: the archive gate opens with the lantern key.", {
      embedding: null,
      migratedCanonical: true,
    }),
    memory("migrated-character", "Migrated character memory: Mira keeps jasmine tea for the user after patrols.", {
      migratedCanonical: true,
    }),
    memory("wrong-rival", "Mira thinks the rival captain earned her complete trust.", {
      status: "wrong",
      correctedAt: "2026-01-03T00:00:00.000Z",
    }),
  ];

  const cases: MemoryRecallEvaluationCase[] = [
    {
      id: "recall-lantern-key",
      question: "Where is the archive key hidden?",
      memories,
      expectedMemoryIds: ["lantern-key", "migrated-summary"],
      migrationCorrectness: true,
    },
    {
      id: "relationship-change",
      question: "How does Mira see the user after the cedar house confrontation?",
      memories,
      expectedMemoryIds: ["mira-trust"],
    },
    {
      id: "time-skip",
      question: "How much time passed before the cedar house arrival?",
      memories,
      expectedMemoryIds: ["time-skip"],
    },
    {
      id: "multiple-participants",
      question: "Who borrowed the brass compass from Mira?",
      memories,
      expectedMemoryIds: ["sable-compass"],
    },
    {
      id: "branchy-scene",
      question: "Which route is the active branch following?",
      memories,
      expectedMemoryIds: ["branch-moon-bridge"],
    },
    {
      id: "message-edit",
      question: "After the edit, where is the vault map?",
      memories,
      expectedMemoryIds: ["edited-map"],
    },
    {
      id: "user-correction",
      question: "Where is the fox mask now?",
      memories,
      expectedMemoryIds: ["new-fox-mask"],
      staleSupersededMemoryIds: ["old-fox-mask"],
      userCorrection: true,
      migrationCorrectness: true,
    },
    {
      id: "deleted-message-negative-control",
      question: "What should we remember about the silver key under the fountain?",
      memories,
      expectedMemoryIds: [],
      wrongMemoryIds: ["deleted-silver-key"],
    },
    {
      id: "extraction-failure-empty-control",
      question: "What did the failed extraction say about the amber bell?",
      memories,
      expectedMemoryIds: [],
      extractionFailed: true,
    },
    {
      id: "migrated-character-memory",
      question: "What does Mira keep for the user after patrols?",
      memories,
      expectedMemoryIds: ["migrated-character"],
      migrationCorrectness: true,
    },
  ];

  return {
    turns: buildTurns(),
    memories,
    cases,
    coverage: {
      recallQuestions: true,
      contradictionsAndSupersession: true,
      timeSkips: true,
      relationshipChanges: true,
      messageEditsAndDeletes: true,
      branchyScenes: true,
      multipleParticipants: true,
      migrationCorrectness: true,
      userCorrectionBehavior: true,
    },
  };
}
