import type {
  MemoryCleanupExpectedState,
  MemoryCleanupProposal,
  MemoryCleanupScope,
  MemoryCleanupSource,
} from "../contracts/types/memory-maintenance";

const MEMORY_CLEANUP_MAX_GROUP_RECORDS = 8;
const MEMORY_CLEANUP_MAX_GROUP_CHARS = 12_000;
const MEMORY_CLEANUP_MAX_NEIGHBORS = 4;

const CONTAINMENT_THRESHOLD = 0.35;
const JACCARD_THRESHOLD = 0.3;
const EMBEDDING_THRESHOLD = 0.78;
const MIN_CONTAINMENT_SHARED_TOKENS = 2;
const MIN_JACCARD_SHARED_TOKENS = 3;

export type MemoryCleanupEvidenceKind = "exact" | "provenance" | "embedding" | "containment" | "jaccard";

export interface MemoryCleanupCandidateEvidence {
  kind: MemoryCleanupEvidenceKind;
  similarity: number;
  sharedTokenCount: number;
  pair: [string, string];
}

const EVIDENCE_PRIORITY: Record<MemoryCleanupEvidenceKind, number> = {
  exact: 5,
  provenance: 4,
  embedding: 3,
  containment: 2,
  jaccard: 1,
};
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "for",
  "from",
  "has",
  "her",
  "his",
  "in",
  "is",
  "it",
  "of",
  "on",
  "the",
  "their",
  "to",
  "was",
  "with",
]);

export interface MemoryCleanupCandidateGroup {
  id: string;
  sourceIds: string[];
  evidence: MemoryCleanupCandidateEvidence;
}

export interface PreparedMemoryCleanupCandidates {
  eligible: MemoryCleanupSource[];
  groups: MemoryCleanupCandidateGroup[];
  deferredCandidateCount: number;
}

function scopeKey(scope: MemoryCleanupScope): string {
  return `${scope.kind}:${scope.id}`;
}

function normalizedContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function meaningfulTokens(content: string): Set<string> {
  return new Set(
    normalizedContent(content)
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 2 && !STOP_WORDS.has(token)) ?? [],
  );
}

function hasSharedMessageId(left: MemoryCleanupSource, right: MemoryCleanupSource): boolean {
  if (left.messageIds.length === 0 || right.messageIds.length === 0) return false;
  const rightIds = new Set(right.messageIds.filter(Boolean));
  return left.messageIds.some((id) => id.length > 0 && rightIds.has(id));
}

function lexicalMetrics(left: MemoryCleanupSource, right: MemoryCleanupSource) {
  const leftTokens = meaningfulTokens(left.content);
  const rightTokens = meaningfulTokens(right.content);
  const sharedTokenCount = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return {
    sharedTokenCount,
    containment: smaller > 0 ? sharedTokenCount / smaller : 0,
    jaccard: union > 0 ? sharedTokenCount / union : 0,
  };
}

function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function orderedPair(leftId: string, rightId: string): [string, string] {
  return leftId.localeCompare(rightId) <= 0 ? [leftId, rightId] : [rightId, leftId];
}

function candidateEvidence(
  left: MemoryCleanupSource,
  right: MemoryCleanupSource,
): MemoryCleanupCandidateEvidence | null {
  if (scopeKey(left.scope) !== scopeKey(right.scope)) return null;
  const pair = orderedPair(left.id, right.id);
  const lexical = lexicalMetrics(left, right);
  if (normalizedContent(left.content) === normalizedContent(right.content)) {
    return { kind: "exact", similarity: 1, sharedTokenCount: lexical.sharedTokenCount, pair };
  }
  if (hasSharedMessageId(left, right)) {
    return { kind: "provenance", similarity: 1, sharedTokenCount: lexical.sharedTokenCount, pair };
  }
  if (left.embedding && right.embedding) {
    const similarity = cosineSimilarity(left.embedding, right.embedding);
    if (similarity !== null && similarity >= EMBEDDING_THRESHOLD) {
      return { kind: "embedding", similarity, sharedTokenCount: lexical.sharedTokenCount, pair };
    }
  }
  if (
    lexical.sharedTokenCount >= MIN_CONTAINMENT_SHARED_TOKENS &&
    lexical.containment >= CONTAINMENT_THRESHOLD
  ) {
    return {
      kind: "containment",
      similarity: lexical.containment,
      sharedTokenCount: lexical.sharedTokenCount,
      pair,
    };
  }
  if (lexical.sharedTokenCount >= MIN_JACCARD_SHARED_TOKENS && lexical.jaccard >= JACCARD_THRESHOLD) {
    return {
      kind: "jaccard",
      similarity: lexical.jaccard,
      sharedTokenCount: lexical.sharedTokenCount,
      pair,
    };
  }
  return null;
}

export function compareMemoryCleanupEvidence(
  left: MemoryCleanupCandidateEvidence,
  right: MemoryCleanupCandidateEvidence,
): number {
  const priority = EVIDENCE_PRIORITY[right.kind] - EVIDENCE_PRIORITY[left.kind];
  if (priority !== 0) return priority;
  const similarity = right.similarity - left.similarity;
  if (similarity !== 0) return similarity;
  const shared = right.sharedTokenCount - left.sharedTokenCount;
  if (shared !== 0) return shared;
  return left.pair.join("\u0000").localeCompare(right.pair.join("\u0000"));
}

export function isMemoryCleanupEligible(source: MemoryCleanupSource): boolean {
  return source.status === "active" || source.status === "pinned";
}

interface MemoryCleanupCandidateEdge {
  key: string;
  leftId: string;
  rightId: string;
  evidence: MemoryCleanupCandidateEvidence;
}

function edgeKey(leftId: string, rightId: string): string {
  return orderedPair(leftId, rightId).join("\u0000");
}

function compareCandidateEdges(left: MemoryCleanupCandidateEdge, right: MemoryCleanupCandidateEdge): number {
  return compareMemoryCleanupEvidence(left.evidence, right.evidence) || left.key.localeCompare(right.key);
}

function allCandidateEdges(eligible: MemoryCleanupSource[]): MemoryCleanupCandidateEdge[] {
  const ordered = [...eligible].sort((left, right) => left.id.localeCompare(right.id));
  const edges: MemoryCleanupCandidateEdge[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      if (!left || !right) continue;
      const evidence = candidateEvidence(left, right);
      if (!evidence) continue;
      edges.push({
        key: edgeKey(left.id, right.id),
        leftId: left.id,
        rightId: right.id,
        evidence,
      });
    }
  }
  return edges.sort(compareCandidateEdges);
}

function retainStrongestNeighbors(edges: MemoryCleanupCandidateEdge[]): MemoryCleanupCandidateEdge[] {
  const bySource = new Map<string, MemoryCleanupCandidateEdge[]>();
  for (const edge of edges) {
    for (const id of [edge.leftId, edge.rightId]) {
      const current = bySource.get(id) ?? [];
      current.push(edge);
      bySource.set(id, current);
    }
  }
  const retainedKeys = new Set<string>();
  for (const sourceEdges of bySource.values()) {
    for (const edge of sourceEdges.sort(compareCandidateEdges).slice(0, MEMORY_CLEANUP_MAX_NEIGHBORS)) {
      retainedKeys.add(edge.key);
    }
  }
  return edges.filter((edge) => retainedKeys.has(edge.key)).sort(compareCandidateEdges);
}

function buildEdgeCoveringGroups(
  eligible: MemoryCleanupSource[],
  retainedEdges: MemoryCleanupCandidateEdge[],
): MemoryCleanupCandidateGroup[] {
  const sourcesById = new Map(eligible.map((source) => [source.id, source]));
  const uncovered = new Map(retainedEdges.map((edge) => [edge.key, edge]));
  const groups: MemoryCleanupCandidateGroup[] = [];

  while (uncovered.size > 0) {
    const seed = [...uncovered.values()].sort(compareCandidateEdges)[0];
    if (!seed) break;
    const selected = new Set([seed.leftId, seed.rightId]);
    let characters =
      (sourcesById.get(seed.leftId)?.content.length ?? 0) +
      (sourcesById.get(seed.rightId)?.content.length ?? 0);

    while (selected.size < MEMORY_CLEANUP_MAX_GROUP_RECORDS) {
      const next = retainedEdges
        .filter(
          (edge) =>
            (selected.has(edge.leftId) && !selected.has(edge.rightId)) ||
            (selected.has(edge.rightId) && !selected.has(edge.leftId)),
        )
        .sort(compareCandidateEdges)
        .map((edge) => (selected.has(edge.leftId) ? edge.rightId : edge.leftId))
        .find((id) => {
          const source = sourcesById.get(id);
          return source && characters + source.content.length <= MEMORY_CLEANUP_MAX_GROUP_CHARS;
        });
      if (!next) break;
      selected.add(next);
      characters += sourcesById.get(next)?.content.length ?? 0;
    }

    const sourceIds = [...selected].sort();
    groups.push({
      id: `cleanup-group-${groups.length + 1}`,
      sourceIds,
      evidence: seed.evidence,
    });
    for (const edge of retainedEdges) {
      if (selected.has(edge.leftId) && selected.has(edge.rightId)) uncovered.delete(edge.key);
    }
  }

  return groups;
}

function buildBoundedCandidateGroups(eligible: MemoryCleanupSource[]): MemoryCleanupCandidateGroup[] {
  return buildEdgeCoveringGroups(eligible, retainStrongestNeighbors(allCandidateEdges(eligible)));
}

export function prepareMemoryCleanupCandidates(sources: MemoryCleanupSource[]): PreparedMemoryCleanupCandidates {
  const eligible = sources.filter(isMemoryCleanupEligible);
  return {
    eligible,
    groups: buildBoundedCandidateGroups(eligible),
    deferredCandidateCount: 0,
  };
}

export function memoryCleanupExpectedState(source: MemoryCleanupSource): MemoryCleanupExpectedState {
  return {
    content: source.content,
    status: source.status,
    updatedAt: source.updatedAt,
    pinned: source.pinned,
    userEdited: source.userEdited,
  };
}

export function validateCleanupProposal(
  proposal: MemoryCleanupProposal,
  sourcesById: ReadonlyMap<string, MemoryCleanupSource>,
): MemoryCleanupProposal {
  if (proposal.type === "conflict" && proposal.selected) {
    throw new Error("Conflicts cannot be selected.");
  }
  if (proposal.type !== "conflict" && proposal.sourceIds.length === 0) {
    throw new Error("Cleanup proposals must consume at least one source.");
  }
  if (new Set(proposal.sourceIds).size !== proposal.sourceIds.length) {
    throw new Error("Cleanup proposals cannot consume a source more than once.");
  }
  if (proposal.winnerId && proposal.sourceIds.includes(proposal.winnerId)) {
    throw new Error("A retained winner cannot also be consumed.");
  }

  const referencedIds = [...proposal.sourceIds, ...(proposal.winnerId ? [proposal.winnerId] : [])];
  const referenced = referencedIds.map((id) => {
    const source = sourcesById.get(id);
    if (!source) throw new Error(`Unknown cleanup source: ${id}`);
    return source;
  });
  const expectedScope = referenced[0]?.scope;
  if (expectedScope && referenced.some((source) => scopeKey(source.scope) !== scopeKey(expectedScope))) {
    throw new Error("Cleanup proposal sources must share one scope.");
  }

  for (const source of referenced) {
    if (!isMemoryCleanupEligible(source)) {
      throw new Error(`Cleanup source ${source.id} is inactive.`);
    }
  }

  if (proposal.type === "keep_one") {
    if (!proposal.winnerId) throw new Error("Keep-one proposals require a winner.");
    if (proposal.replacement) throw new Error("Keep-one proposals cannot create a replacement.");
    const winner = sourcesById.get(proposal.winnerId);
    if (referenced.some((source) => source.pinned) && !winner?.pinned) {
      throw new Error("Keep-one cleanup must retain a pinned winner.");
    }
  }
  if (proposal.type === "combine") {
    if (proposal.sourceIds.length < 2) {
      throw new Error("Combine cleanup requires at least two sources.");
    }
    if (!proposal.replacement?.content.trim() || !proposal.replacement.kind.trim()) {
      throw new Error("Cleanup replacement content and kind are required.");
    }
  }

  return proposal;
}
