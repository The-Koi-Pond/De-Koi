export interface MemoryRecallPriorityCandidate {
  id?: unknown;
  content: string;
}

export interface MemoryRecallPrioritySkipped<T extends MemoryRecallPriorityCandidate> {
  candidate: T;
  overlappingSourceLabel: string;
  reason: "overlaps_character_memory";
}

export interface MemoryRecallPriorityResult<T extends MemoryRecallPriorityCandidate> {
  retained: T[];
  skipped: Array<MemoryRecallPrioritySkipped<T>>;
}

const CONTEXT_PRIORITY_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "from",
  "that",
  "their",
  "there",
  "these",
  "those",
  "through",
  "user",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

function priorityTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .match(/[a-z0-9]+/g);
  return new Set((tokens ?? []).filter((token) => token.length >= 3 && !CONTEXT_PRIORITY_STOP_WORDS.has(token)));
}

function overlapTokenCount(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared;
}

function stronglyOverlaps(candidateText: string, sourceText: string): boolean {
  const candidateTokens = priorityTokens(candidateText);
  const sourceTokens = priorityTokens(sourceText);
  if (candidateTokens.size < 4 || sourceTokens.size < 4) return false;

  const shared = overlapTokenCount(candidateTokens, sourceTokens);
  const smallerCoverage = shared / Math.min(candidateTokens.size, sourceTokens.size);
  const candidateCoverage = shared / candidateTokens.size;
  return shared >= 4 && (smallerCoverage >= 0.75 || candidateCoverage >= 0.8);
}

export function prioritizeMemoryRecallAgainstCharacterMemories<T extends MemoryRecallPriorityCandidate>(
  candidates: T[],
  characterMemoryLines: string[],
): MemoryRecallPriorityResult<T> {
  const sourceLines = characterMemoryLines.map((line, index) => ({
    label: `Character memory ${index + 1}`,
    text: line.trim(),
  })).filter((line) => line.text.length > 0);

  if (sourceLines.length === 0 || candidates.length === 0) {
    return { retained: candidates, skipped: [] };
  }

  const retained: T[] = [];
  const skipped: Array<MemoryRecallPrioritySkipped<T>> = [];
  for (const candidate of candidates) {
    const overlappingSource = sourceLines.find((source) => stronglyOverlaps(candidate.content, source.text));
    if (overlappingSource) {
      skipped.push({
        candidate,
        overlappingSourceLabel: overlappingSource.label,
        reason: "overlaps_character_memory",
      });
    } else {
      retained.push(candidate);
    }
  }

  return { retained, skipped };
}