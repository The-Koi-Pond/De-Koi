import type { LorebookEntry } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { localEmbed } from "../local-embedder.js";
import { embedMemoryRecallTexts, type MemoryRecallEmbeddingOptions } from "../memory-recall.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";

const DEFAULT_SEMANTIC_TOP_K = 40;
const DEFAULT_WARMUP_BATCH_SIZE = 32;

export type LorebookEmbeddingOptions = MemoryRecallEmbeddingOptions;

export interface LorebookEmbeddingWarmupResult {
  attempted: number;
  embedded: number;
}

export interface SemanticLorebookMatch {
  entry: LorebookEntry;
  similarity: number;
}

function normalizedParts(parts: Array<[string, unknown]>): string[] {
  const lines: string[] = [];
  for (const [label, value] of parts) {
    if (Array.isArray(value)) {
      const text = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .join(", ");
      if (text) lines.push(`${label}: ${text}`);
      continue;
    }
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) lines.push(`${label}: ${text}`);
  }
  return lines;
}

export function buildLorebookEntryEmbeddingText(entry: LorebookEntry): string {
  return normalizedParts([
    ["Name", entry.name],
    ["Description", entry.description],
    ["Keys", entry.keys],
    ["Secondary Keys", entry.secondaryKeys],
    ["Content", entry.content],
  ]).join("\n\n");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.max(1, Math.trunc(numeric));
}

async function embedLorebookTexts(texts: string[], options: LorebookEmbeddingOptions): Promise<number[][]> {
  return embedMemoryRecallTexts(texts, {
    localEmbedder: options.localEmbedder ?? localEmbed,
    embeddingSource: options.embeddingSource,
  });
}

export async function warmLorebookEntryEmbeddings(
  db: DB,
  entries: LorebookEntry[],
  options: LorebookEmbeddingOptions & { batchSize?: number } = {},
): Promise<LorebookEmbeddingWarmupResult> {
  const batchSize = normalizePositiveInteger(options.batchSize, DEFAULT_WARMUP_BATCH_SIZE);
  const candidates = entries
    .filter((entry) => entry.enabled && (!entry.embedding || entry.embedding.length === 0))
    .slice(0, batchSize);
  if (candidates.length === 0) return { attempted: 0, embedded: 0 };

  const texts = candidates.map(buildLorebookEntryEmbeddingText);
  const embeddings = await embedLorebookTexts(texts, options);
  if (embeddings.length === 0) return { attempted: candidates.length, embedded: 0 };

  const storage = createLorebooksStorage(db);
  let embedded = 0;
  for (let index = 0; index < candidates.length; index++) {
    const vector = embeddings[index];
    if (!vector || vector.length === 0) continue;
    await storage.updateEntryEmbedding(candidates[index]!.id, vector);
    candidates[index]!.embedding = vector;
    embedded += 1;
  }

  if (embedded > 0) {
    logger.debug("[lorebook-embeddings] Warmed %d/%d missing entry embedding(s)", embedded, candidates.length);
  }
  return { attempted: candidates.length, embedded };
}

export async function semanticShortlistLorebookEntries(
  entries: LorebookEntry[],
  query: string,
  options: LorebookEmbeddingOptions & { topK?: number } = {},
): Promise<SemanticLorebookMatch[] | null> {
  const topK = normalizePositiveInteger(options.topK, DEFAULT_SEMANTIC_TOP_K);
  const queryText = query.trim();
  if (!queryText) return null;

  const queryEmbeddings = await embedLorebookTexts([queryText], options);
  const queryEmbedding = queryEmbeddings[0];
  if (!queryEmbedding || queryEmbedding.length === 0) return null;

  let dimensionMismatchLogged = false;
  const matches = entries
    .map((entry) => {
      const embedding = entry.embedding;
      if (!embedding || embedding.length === 0) return null;
      if (embedding.length !== queryEmbedding.length) {
        if (!dimensionMismatchLogged) {
          dimensionMismatchLogged = true;
          logger.warn(
            "[lorebook-embeddings] Skipping one or more lorebook entries with embedding dimensions that do not match the query vector (%d vs %d). Refresh lorebook embeddings after changing embedding models.",
            embedding.length,
            queryEmbedding.length,
          );
        }
        return null;
      }
      return { entry, similarity: cosineSimilarity(queryEmbedding, embedding) };
    })
    .filter((match): match is SemanticLorebookMatch => match !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
  return matches.length > 0 ? matches : null;
}
