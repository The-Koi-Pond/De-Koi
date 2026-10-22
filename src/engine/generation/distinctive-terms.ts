// How strongly a memory shares the words the latest message is asking about.
//
// Long chats make plain word overlap useless for ranking: the character's name, the setting and everyday
// words appear in most memories, so the fact a player is actually asking about scores no higher than the
// rest. Two things fix that without an embedding model:
// - rarity: each shared word is weighted by how rare it is across the memories and the chat's own messages
//   (inverse document frequency, as in BM25), so one distinctive word ("eel", "Mireille") beats many common ones;
// - focus: words in the clauses that ask something count fully, while scene narration around the question
//   counts for less, so incidental rare words ("smudge", "slate") don't decide what gets recalled.

export interface DistinctiveTermWeights {
  /** 0..1: 1 for a word found in one document, falling toward 0 for words most documents share. */
  weight(token: string): number;
}

/** Builds word weights from token sets: the memories being ranked plus the chat's messages. */
export function distinctiveTermWeights(documents: Iterable<ReadonlySet<string>>): DistinctiveTermWeights {
  const documentFrequency = new Map<string, number>();
  let documentCount = 0;
  for (const tokens of documents) {
    documentCount += 1;
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const idf = (frequency: number) => Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
  const rarest = idf(1);
  return {
    weight(token) {
      const frequency = documentFrequency.get(token) ?? 0;
      if (frequency === 0 || rarest <= 0) return 0;
      // Squared so mid-frequency words count for little: a long memory that shares many of them should not
      // outrank a short one that shares the one word that matters.
      const normalized = Math.min(1, idf(frequency) / rarest);
      return normalized * normalized;
    },
  };
}

// Words outside the asking clauses count at this weight.
const BACKGROUND_QUERY_WEIGHT = 0.35;
const ASKING_CLAUSE = /\?|\b(?:remember|recall|remind)\b/i;

/** Per-word weight of the latest message: 1 in the clauses that ask something, less elsewhere. */
export function queryTermFocus(text: string, tokenize: (text: string) => Iterable<string>): Map<string, number> {
  // Clauses end at sentence punctuation and at action/speech boundaries (*actions*, "speech").
  const clauses = text.match(/[^.!?*"“”\n]+[.!?]*/g) ?? [text];
  const anyAsking = clauses.some((clause) => ASKING_CLAUSE.test(clause));
  const focus = new Map<string, number>();
  for (const clause of clauses) {
    const weight = !anyAsking || ASKING_CLAUSE.test(clause) ? 1 : BACKGROUND_QUERY_WEIGHT;
    for (const token of tokenize(clause)) focus.set(token, Math.max(focus.get(token) ?? 0, weight));
  }
  return focus;
}

/** 0..1 match strength between the latest message's words and one memory's words. */
export function distinctiveMatch(
  queryFocus: ReadonlyMap<string, number>,
  memoryTokens: ReadonlySet<string>,
  weights: DistinctiveTermWeights,
): number {
  let total = 0;
  for (const [token, focus] of queryFocus) {
    if (memoryTokens.has(token)) total += weights.weight(token) * focus;
  }
  return 1 - Math.exp(-total);
}
