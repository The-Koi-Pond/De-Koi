export const BEHAVIORAL_EXAMPLE_POOL_VERSION = 1 as const;

type BehavioralExampleSourceField =
  | "mes_example"
  | "first_mes"
  | "alternate_greeting"
  | "description_quote"
  | "backstory_quote"
  | "scenario_quote";

export interface BehavioralExampleCharacter {
  id: string;
  name: string;
  mesExample?: string;
  firstMes?: string;
  alternateGreetings?: readonly string[];
  description?: string;
  backstory?: string;
  scenario?: string;
}

export interface BehavioralExampleCandidate {
  version: typeof BEHAVIORAL_EXAMPLE_POOL_VERSION;
  id: string;
  characterId: string;
  characterName: string;
  sourceField: BehavioralExampleSourceField;
  sourceIndex: number;
  dialogueText: string;
  contentHash: string;
  normalizedContent: string;
  estimatedTokens: number;
}

type BehavioralExampleSelectionMode = "compatibility" | "lexical" | "semantic";

interface RankedBehavioralExample {
  candidate: BehavioralExampleCandidate;
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  reason: "selected" | "history_overlap" | "candidate_cap" | "token_budget";
}

export interface BehavioralExampleSelection {
  activated: boolean;
  mode: BehavioralExampleSelectionMode;
  selected: RankedBehavioralExample[];
  skipped: RankedBehavioralExample[];
  renderedByCharacter: Record<string, string>;
}

export interface SelectBehavioralExamplesInput {
  candidates: readonly BehavioralExampleCandidate[];
  queryText: string;
  visibleHistory: readonly string[];
  selectionThresholdTokens: number;
  tokenBudget: number;
  candidateCap: number;
  embed?: ((texts: string[]) => Promise<number[][] | null>) | null;
  resolveForHistory?: (text: string) => string;
}

const LEXICAL_STOPWORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "have",
  "that",
  "the",
  "this",
  "was",
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

function normalizeContent(value: string): string {
  return value
    .replace(/^<START>\s*$/gim, "")
    .replace(/^\s*(?:\{\{user\}\}|\{\{char\}\}|[^:\n]{1,80})\s*:\s*/gim, "")
    .replace(/["“”'‘’.,!?;:()[\]{}*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function exampleBlocks(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?=^<START>\s*$)/gim)
    .map((block) => block.trim())
    .filter((block) => /^<START>\s*$/im.test(block) && /^\s*\{\{char\}\}\s*:\s*\S+/im.test(block));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributedQuotes(
  character: BehavioralExampleCharacter,
  value: string | undefined,
  sourceField: Extract<BehavioralExampleSourceField, "description_quote" | "backstory_quote" | "scenario_quote">,
): BehavioralExampleCandidate[] {
  const speaker = `(?:\\{\\{char\\}\\}|${escapeRegExp(character.name.trim())})`;
  const pattern = new RegExp(`^\\s*${speaker}\\s*:\\s*(["“].+["”])\\s*$`, "gimu");
  return Array.from(value?.matchAll(pattern) ?? [], (match, index) =>
    candidate(character, sourceField, index, `<START>\n{{char}}: ${match[1]}`),
  );
}

function candidate(
  character: BehavioralExampleCharacter,
  sourceField: BehavioralExampleSourceField,
  sourceIndex: number,
  dialogueText: string,
): BehavioralExampleCandidate {
  const normalizedContent = normalizeContent(dialogueText);
  const contentHash = stableHash(normalizedContent);
  return {
    version: BEHAVIORAL_EXAMPLE_POOL_VERSION,
    id: `${character.id}:${sourceField}:${sourceIndex}:${contentHash}`,
    characterId: character.id,
    characterName: character.name,
    sourceField,
    sourceIndex,
    dialogueText,
    contentHash,
    normalizedContent,
    estimatedTokens: Math.max(1, Math.ceil(dialogueText.length / 4)),
  };
}

function lexicalTokens(value: string): Set<string> {
  return new Set(
    Array.from(value.toLowerCase().matchAll(/[\p{Letter}\p{Number}]{2,}/gu), (match) => match[0]).filter(
      (token) => !LEXICAL_STOPWORDS.has(token),
    ),
  );
}

function lexicalOverlap(query: Set<string>, content: Set<string>): number {
  let score = 0;
  for (const token of query) {
    if (content.has(token)) score += 1;
  }
  return score;
}

function validEmbedding(value: unknown, expectedDimensions?: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    (expectedDimensions === undefined || value.length === expectedDimensions) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator > 0 ? dot / denominator : 0;
}

function selectedTextByCharacter(selected: readonly RankedBehavioralExample[]): Record<string, string> {
  const grouped = new Map<string, string[]>();
  for (const entry of selected) {
    const values = grouped.get(entry.candidate.characterId) ?? [];
    values.push(entry.candidate.dialogueText);
    grouped.set(entry.candidate.characterId, values);
  }
  return Object.fromEntries(Array.from(grouped, ([characterId, values]) => [characterId, values.join("\n\n")]));
}

export async function selectBehavioralExamples(
  input: SelectBehavioralExamplesInput,
): Promise<BehavioralExampleSelection> {
  const selectionThresholdTokens = Math.max(0, Math.floor(input.selectionThresholdTokens));
  const totalTokens = input.candidates.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
  if (totalTokens <= selectionThresholdTokens) {
    return {
      activated: false,
      mode: "compatibility",
      selected: [],
      skipped: [],
      renderedByCharacter: {},
    };
  }

  const history = new Set(input.visibleHistory.map(normalizeContent).filter(Boolean));
  const queryTokens = lexicalTokens(input.queryText);
  const eligible: RankedBehavioralExample[] = [];
  const skipped: RankedBehavioralExample[] = [];
  for (const candidate of input.candidates) {
    const lexicalScore = lexicalOverlap(queryTokens, lexicalTokens(candidate.dialogueText));
    const entry: RankedBehavioralExample = {
      candidate,
      score: lexicalScore,
      lexicalScore,
      semanticScore: null,
      reason: "selected",
    };
    const historyComparableContent = normalizeContent(
      input.resolveForHistory?.(candidate.dialogueText) ?? candidate.dialogueText,
    );
    if (history.has(historyComparableContent)) {
      skipped.push({ ...entry, reason: "history_overlap" });
    } else {
      eligible.push(entry);
    }
  }

  let mode: BehavioralExampleSelectionMode = "lexical";
  if (input.embed && eligible.length > 0) {
    try {
      const vectors = await input.embed([input.queryText, ...eligible.map((entry) => entry.candidate.dialogueText)]);
      const queryVector = vectors?.[0];
      if (
        validEmbedding(queryVector) &&
        vectors?.length === eligible.length + 1 &&
        vectors.slice(1).every((vector) => validEmbedding(vector, queryVector.length))
      ) {
        mode = "semantic";
        eligible.forEach((entry, index) => {
          const semanticScore = cosineSimilarity(queryVector, vectors[index + 1]!);
          entry.semanticScore = semanticScore;
          entry.score = semanticScore * 4 + entry.lexicalScore;
        });
      }
    } catch {
      mode = "lexical";
    }
  }

  eligible.sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.sourceIndex - right.candidate.sourceIndex ||
      left.candidate.id.localeCompare(right.candidate.id),
  );

  const candidateCap = Math.max(0, Math.floor(input.candidateCap));
  const tokenBudget = Math.max(0, Math.floor(input.tokenBudget));
  const topCandidate = eligible[0];
  const voiceBaseline =
    candidateCap > 1 && topCandidate
      ? eligible.find(
          (entry) =>
            entry !== topCandidate &&
            entry.candidate.characterId === topCandidate.candidate.characterId &&
            entry.candidate.sourceField === "mes_example" &&
            entry.candidate.sourceIndex === 0,
        )
      : undefined;
  const selectionOrder = voiceBaseline
    ? [topCandidate!, voiceBaseline, ...eligible.filter((entry) => entry !== topCandidate && entry !== voiceBaseline)]
    : eligible;
  const selected: RankedBehavioralExample[] = [];
  let usedTokens = 0;
  for (const entry of selectionOrder) {
    if (selected.length >= candidateCap) {
      skipped.push({ ...entry, reason: "candidate_cap" });
      continue;
    }
    if (usedTokens + entry.candidate.estimatedTokens > tokenBudget) {
      skipped.push({ ...entry, reason: "token_budget" });
      continue;
    }
    selected.push(entry);
    usedTokens += entry.candidate.estimatedTokens;
  }

  return {
    activated: true,
    mode,
    selected,
    skipped,
    renderedByCharacter: selectedTextByCharacter(selected),
  };
}

export function buildBehavioralExamplePool(
  characters: readonly BehavioralExampleCharacter[],
): BehavioralExampleCandidate[] {
  const candidates = characters.flatMap((character) => [
    ...exampleBlocks(character.mesExample).map((block, index) => candidate(character, "mes_example", index, block)),
    ...(character.firstMes?.trim()
      ? [candidate(character, "first_mes", 0, `<START>\n{{char}}: ${character.firstMes.trim()}`)]
      : []),
    ...(character.alternateGreetings ?? [])
      .map((greeting, index) =>
        greeting.trim()
          ? candidate(character, "alternate_greeting", index, `<START>\n{{char}}: ${greeting.trim()}`)
          : null,
      )
      .filter((entry): entry is BehavioralExampleCandidate => entry !== null),
    ...attributedQuotes(character, character.description, "description_quote"),
    ...attributedQuotes(character, character.backstory, "backstory_quote"),
    ...attributedQuotes(character, character.scenario, "scenario_quote"),
  ]);

  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const key = `${entry.characterId}:${entry.normalizedContent}`;
    if (!entry.normalizedContent || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
