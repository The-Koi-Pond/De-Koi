import type {
  MemoryCleanupExpectedState,
  MemoryCleanupProposal,
  MemoryCleanupScope,
  MemoryCleanupSource,
} from "../contracts/types/memory-maintenance";

const MEMORY_CLEANUP_MAX_GROUPS = 20;
const MEMORY_CLEANUP_MAX_GROUP_RECORDS = 8;
const MEMORY_CLEANUP_MAX_GROUP_CHARS = 12_000;

const LEXICAL_SIMILARITY_THRESHOLD = 0.6;
const EMBEDDING_SIMILARITY_THRESHOLD = 0.88;
const MIN_SHARED_LEXICAL_TOKENS = 3;
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

interface MemoryCleanupCandidateGroup {
  id: string;
  sourceIds: string[];
}

interface BuiltMemoryCleanupCandidateGroups {
  groups: MemoryCleanupCandidateGroup[];
  deferredCandidateCount: number;
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

function lexicalSimilarity(left: MemoryCleanupSource, right: MemoryCleanupSource): boolean {
  const leftTokens = meaningfulTokens(left.content);
  const rightTokens = meaningfulTokens(right.content);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared < MIN_SHARED_LEXICAL_TOKENS) return false;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && shared / union >= LEXICAL_SIMILARITY_THRESHOLD;
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

function embeddingSimilarity(left: MemoryCleanupSource, right: MemoryCleanupSource): boolean {
  if (!left.embedding || !right.embedding) return false;
  const similarity = cosineSimilarity(left.embedding, right.embedding);
  return similarity !== null && similarity >= EMBEDDING_SIMILARITY_THRESHOLD;
}

function shouldGroup(left: MemoryCleanupSource, right: MemoryCleanupSource): boolean {
  // Cleanup is reviewed and applied atomically for one owner scope. Identical
  // content in another scope is intentionally a separate review, never a
  // cross-owner deletion candidate.
  if (scopeKey(left.scope) !== scopeKey(right.scope)) return false;
  return (
    normalizedContent(left.content) === normalizedContent(right.content) ||
    hasSharedMessageId(left, right) ||
    lexicalSimilarity(left, right) ||
    embeddingSimilarity(left, right)
  );
}

export function isMemoryCleanupEligible(source: MemoryCleanupSource): boolean {
  return source.status === "active" || source.status === "pinned";
}

function boundedGroup(sources: MemoryCleanupSource[], sequence: number): MemoryCleanupCandidateGroup | null {
  const selected: MemoryCleanupSource[] = [];
  let characters = 0;
  for (const source of sources) {
    if (selected.length >= MEMORY_CLEANUP_MAX_GROUP_RECORDS) break;
    if (selected.length > 0 && characters + source.content.length > MEMORY_CLEANUP_MAX_GROUP_CHARS) break;
    selected.push(source);
    characters += source.content.length;
  }
  if (selected.length < 2) return null;
  return {
    id: `cleanup-group-${sequence + 1}`,
    sourceIds: selected.map((source) => source.id),
  };
}

function exactDuplicateGroup(sources: MemoryCleanupSource[], sequence: number): MemoryCleanupCandidateGroup | null {
  const selected = sources.slice(0, MEMORY_CLEANUP_MAX_GROUP_RECORDS);
  if (selected.length < 2) return null;
  return {
    id: `cleanup-group-${sequence + 1}`,
    sourceIds: selected.map((source) => source.id),
  };
}

function buildBoundedCandidateGroups(eligible: MemoryCleanupSource[]): BuiltMemoryCleanupCandidateGroups {
  const adjacency = new Map(eligible.map((source) => [source.id, new Set<string>()]));

  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const left = eligible[leftIndex];
      const right = eligible[rightIndex];
      if (!left || !right || !shouldGroup(left, right)) continue;
      adjacency.get(left.id)?.add(right.id);
      adjacency.get(right.id)?.add(left.id);
    }
  }

  const byId = new Map(eligible.map((source) => [source.id, source]));
  const visited = new Set<string>();
  const groups: MemoryCleanupCandidateGroup[] = [];
  let deferredCandidateCount = 0;

  for (const source of eligible) {
    if (visited.has(source.id) || (adjacency.get(source.id)?.size ?? 0) === 0) continue;
    const component: MemoryCleanupSource[] = [];
    const pending = [source.id];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const member = byId.get(id);
      if (member) component.push(member);
      for (const adjacent of adjacency.get(id) ?? []) {
        if (!visited.has(adjacent)) pending.push(adjacent);
      }
    }
    const normalized = normalizedContent(component[0]?.content ?? "");
    const exactDuplicates = component.every((member) => normalizedContent(member.content) === normalized);
    const group = exactDuplicates
      ? exactDuplicateGroup(component, groups.length)
      : boundedGroup(component, groups.length);
    if (group) groups.push(group);
    if (!group || group.sourceIds.length < component.length) {
      deferredCandidateCount += 1;
    }
  }

  return { groups, deferredCandidateCount };
}

export function prepareMemoryCleanupCandidates(sources: MemoryCleanupSource[]): PreparedMemoryCleanupCandidates {
  const eligible = sources.filter(isMemoryCleanupEligible);
  const built = buildBoundedCandidateGroups(eligible);
  return {
    eligible,
    groups: built.groups.slice(0, MEMORY_CLEANUP_MAX_GROUPS),
    deferredCandidateCount: built.deferredCandidateCount + Math.max(0, built.groups.length - MEMORY_CLEANUP_MAX_GROUPS),
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
