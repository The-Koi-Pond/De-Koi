const OVERLAP_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "under",
  "was",
  "with",
]);

const MIN_OVERLAP_TOKENS = 4;
const SUPPRESSIBLE_OVERLAP_COVERAGE = 0.85;

function overlapTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !OVERLAP_STOPWORDS.has(token));
}

function tokenSet(value: string): Set<string> {
  return new Set(overlapTokens(value));
}

export function isSuppressibleContextOverlap(content: string, fresherContextTexts: readonly string[]): boolean {
  const contentTokens = tokenSet(content);
  if (contentTokens.size < MIN_OVERLAP_TOKENS) return false;

  for (const fresherText of fresherContextTexts) {
    const sourceTokens = tokenSet(fresherText);
    if (sourceTokens.size === 0) continue;
    let shared = 0;
    for (const token of contentTokens) {
      if (sourceTokens.has(token)) shared += 1;
    }
    if (shared / contentTokens.size >= SUPPRESSIBLE_OVERLAP_COVERAGE) return true;
  }

  return false;
}