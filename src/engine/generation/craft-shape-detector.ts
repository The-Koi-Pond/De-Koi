import { hiddenFromAi, readString, type JsonRecord } from "./runtime-records";

const MAX_ASSISTANT_TURNS = 8;
const MAX_TURN_CHARS = 8_000;

export interface CraftShapeFinding {
  issue: "contrast-ladder" | "fragment-ladder" | "mind-reading" | "forced-question" | "repeated-opening";
  directive: string;
  evidence: [string, string];
}

export interface CraftCandidateFinding {
  issue: CraftShapeFinding["issue"];
  directive: string;
  evidence: [string, ...string[]];
}

const DIRECTIVES: Record<CraftShapeFinding["issue"], string> = {
  "contrast-ladder":
    "Break the repeated contrast ladder. State the next image or action directly; do not stack not/no/just fragments or explain the contrast afterward.",
  "fragment-ladder":
    "Avoid another ladder of clipped fragments that culminates in an abstract explanation. Use scene-specific action or dialogue and stop before interpreting it.",
  "mind-reading":
    "Do not tell the user what they really mean, want, or feel. React to their actual words and let them define their intent.",
  "forced-question": "Let a natural statement stand; do not add a question merely to continue the chat.",
  "repeated-opening":
    "Vary the entry shape of the next reply. Do not reuse the cited sentence opening; begin from the specific action, voice, or detail of this beat.",
};

function recentVisibleMessages(messages: readonly JsonRecord[]): JsonRecord[] {
  return messages.filter((message) => !hiddenFromAi(message)).slice(-32);
}

function assistantTurns(messages: readonly JsonRecord[]): string[] {
  return recentVisibleMessages(messages)
    .filter((message) => readString(message.role).trim() === "assistant")
    .map((message) => readString(message.content).trim().slice(0, MAX_TURN_CHARS))
    .filter(Boolean)
    .slice(-MAX_ASSISTANT_TURNS);
}

function recentUserText(messages: readonly JsonRecord[]): string {
  return recentVisibleMessages(messages)
    .filter((message) => readString(message.role).trim() === "user")
    .map((message) => readString(message.content).trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n");
}

function sentenceSegments(text: string): string[] {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/gu) ?? []).map((part) => part.trim()).filter(Boolean);
}

function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function finding(issue: CraftShapeFinding["issue"], excerpts: readonly string[]): CraftShapeFinding | null {
  const evidence = distinct(excerpts);
  if (evidence.length < 2) return null;
  return {
    issue,
    directive: DIRECTIVES[issue],
    evidence: [evidence[0]!, evidence[1]!],
  };
}

function candidateFinding(
  issue: CraftShapeFinding["issue"],
  excerpts: readonly string[],
): CraftCandidateFinding | null {
  const evidence = distinct(excerpts).slice(0, 2);
  if (evidence.length === 0) return null;
  return {
    issue,
    directive: DIRECTIVES[issue],
    evidence: evidence as [string, ...string[]],
  };
}

function startsNegativeFragment(sentence: string): boolean {
  return /^(?:not|no|nothing)\b/iu.test(sentence);
}

function startsContrastResolution(sentence: string): boolean {
  return /^(?:just|only|simply|enough\b)/iu.test(sentence);
}

function contrastLadders(turn: string): string[] {
  const sentences = sentenceSegments(turn);
  const excerpts: string[] = [];
  for (let start = 0; start < sentences.length; start += 1) {
    for (let length = 3; length <= 5 && start + length <= sentences.length; length += 1) {
      const window = sentences.slice(start, start + length);
      const negativeCount = window.filter(startsNegativeFragment).length;
      if (negativeCount >= 2 && window.some(startsContrastResolution)) {
        excerpts.push(window.join(" "));
        break;
      }
    }
  }
  for (const sentence of sentences) {
    if (/\bnot\b[^.!?\n]{1,120}\b(?:but|just)\b/iu.test(sentence)) excerpts.push(sentence);
  }
  return distinct(excerpts);
}

function candidateContrastLadders(turn: string): string[] {
  const excerpts = contrastLadders(turn);
  const sentences = sentenceSegments(turn);
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    const window = sentences.slice(index, index + 3);
    const negatives = window.filter(startsNegativeFragment);
    if (negatives.length >= 2 && negatives.some((sentence) => wordCount(sentence) >= 2)) {
      excerpts.push(window.join(" "));
    }
  }
  return distinct(excerpts);
}

function wordCount(value: string): number {
  return value.match(/[\p{L}\p{N}']+/gu)?.length ?? 0;
}

function fragmentLadders(turn: string): string[] {
  const sentences = sentenceSegments(turn);
  const excerpts: string[] = [];
  for (let index = 0; index + 3 < sentences.length; index += 1) {
    const window = sentences.slice(index, index + 3);
    const explanation = sentences[index + 3]!;
    if (
      window.every((sentence) => wordCount(sentence) >= 1 && wordCount(sentence) <= 4) &&
      wordCount(explanation) >= 4
    ) {
      excerpts.push(window.join(" "));
    }
  }
  return distinct(excerpts).filter((excerpt) => contrastLadders(excerpt).length === 0);
}

function candidateFragmentLadders(turn: string): string[] {
  const excerpts = fragmentLadders(turn);
  const sentences = sentenceSegments(turn);
  for (let index = 0; index + 2 < sentences.length; index += 1) {
    const fragments = sentences.slice(index, index + 2);
    const explanation = sentences[index + 2]!;
    if (
      fragments.every((sentence) => wordCount(sentence) >= 1 && wordCount(sentence) <= 4) &&
      wordCount(explanation) >= 6
    ) {
      excerpts.push(fragments.join(" "));
    }
  }
  for (const sentence of sentences) {
    if (/\bsomething\b[^.!?\n]{1,120}\bsomething\b/iu.test(sentence)) excerpts.push(sentence);
  }
  return distinct(excerpts).filter((excerpt) => candidateContrastLadders(excerpt).length === 0);
}

function mindReadingRestatements(turn: string): string[] {
  const sentences = sentenceSegments(turn);
  const excerpts: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    if (
      /\bwhat you(?:'re| are) really (?:ask(?:ing)?|say(?:ing)?|mean(?:ing)?|want(?:ing)?|feel(?:ing)?)\b/iu.test(
        sentence,
      )
    ) {
      excerpts.push(sentence);
    }
    const next = sentences[index + 1];
    if (
      next &&
      /\byou (?:don't|do not) (?:want|mean|feel|need)\b/iu.test(sentence) &&
      /\byou (?:want|mean|feel|need)\b/iu.test(next)
    ) {
      excerpts.push(`${sentence} ${next}`);
    }
  }
  return distinct(excerpts);
}

function explicitlyRequestsRepetition(messages: readonly JsonRecord[]): boolean {
  const text = recentUserText(messages);
  return (
    /\b(?:use|write|keep|make|continue)\b[^.!?\n]{0,80}\b(?:repeat(?:ed|ing)?|repetition|refrain|chant|litany|anaphora|parallel phrasing)\b/iu.test(
      text,
    ) || /\brepeat\b[^.!?\n]{0,60}\b(?:ritual|line|phrase|wording)\b/iu.test(text)
  );
}

function explicitlyRejectsQuestions(messages: readonly JsonRecord[]): boolean {
  return /\b(?:do not|don't|stop|quit)\s+(?:asking?|adding)\b[^.!?\n]{0,40}\bquestions?\b/iu.test(
    recentUserText(messages),
  );
}

function explicitlyRequestsQuestions(messages: readonly JsonRecord[]): boolean {
  if (explicitlyRejectsQuestions(messages)) return false;
  const text = recentUserText(messages);
  return (
    /\b(?:keep|please|can you|could you|would you|i want you to|go ahead and)\b[^.!?\n]{0,60}\bask(?:ing)?\b/iu.test(
      text,
    ) || /\b(?:interview|quiz)\s+me\b/iu.test(text)
  );
}

function firstExcerptPerTurn(turns: readonly string[], detector: (turn: string) => string[]): string[] {
  return turns.map((turn) => detector(turn)[0] ?? "").filter(Boolean);
}

function repeatedOpeningEvidence(turns: readonly string[]): string[] {
  const firstBySignature = new Map<string, string>();
  for (const turn of turns) {
    for (const sentence of sentenceSegments(turn)) {
      const words = sentence.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
      if (words.length < 7) continue;
      const signature = words.slice(0, 4).join(" ");
      if (signature.length < 16) continue;
      const first = firstBySignature.get(signature);
      if (first && first !== sentence) return [first, sentence];
      firstBySignature.set(signature, sentence);
    }
  }
  return [];
}

export function detectConversationCraftShape(messages: readonly JsonRecord[]): CraftShapeFinding | null {
  const turns = assistantTurns(messages);
  const mindReading = finding("mind-reading", firstExcerptPerTurn(turns, mindReadingRestatements));
  if (mindReading) return mindReading;

  if (!explicitlyRequestsQuestions(messages)) {
    const trailingQuestions = turns.slice(-3);
    if (trailingQuestions.length === 3 && trailingQuestions.every((turn) => /\?\s*$/u.test(turn))) {
      return finding("forced-question", trailingQuestions);
    }
  }

  if (!explicitlyRequestsRepetition(messages)) {
    return (
      finding("contrast-ladder", firstExcerptPerTurn(turns, contrastLadders)) ??
      finding("fragment-ladder", firstExcerptPerTurn(turns, fragmentLadders)) ??
      finding("repeated-opening", repeatedOpeningEvidence(turns))
    );
  }
  return null;
}

export function detectRoleplayCraftShape(messages: readonly JsonRecord[]): CraftShapeFinding | null {
  if (explicitlyRequestsRepetition(messages)) return null;
  const turns = assistantTurns(messages);
  return (
    finding("contrast-ladder", firstExcerptPerTurn(turns, contrastLadders)) ??
    finding("fragment-ladder", firstExcerptPerTurn(turns, fragmentLadders)) ??
    finding("repeated-opening", repeatedOpeningEvidence(turns))
  );
}

function candidateRepeatedOpeningEvidence(messages: readonly JsonRecord[], candidate: string): string[] {
  const evidence = repeatedOpeningEvidence([...assistantTurns(messages), candidate]);
  return evidence.some((excerpt) => candidate.includes(excerpt)) ? evidence : [];
}

function recentAssistantQuestionEndings(messages: readonly JsonRecord[], limit: number): string[] {
  return assistantTurns(messages)
    .slice(-limit)
    .filter((turn) => /\?\s*$/u.test(turn));
}

export function detectConversationCraftCandidate(
  messages: readonly JsonRecord[],
  candidate: string,
): CraftCandidateFinding | null {
  const text = candidate.trim().slice(0, MAX_TURN_CHARS);
  if (!text) return null;

  const mindReading = candidateFinding("mind-reading", mindReadingRestatements(text));
  if (mindReading) return mindReading;

  if (
    !explicitlyRequestsQuestions(messages) &&
    /\?\s*$/u.test(text) &&
    recentAssistantQuestionEndings(messages, 2).length === 2
  ) {
    return candidateFinding("forced-question", [text]);
  }

  if (!explicitlyRequestsRepetition(messages)) {
    return (
      candidateFinding("contrast-ladder", candidateContrastLadders(text)) ??
      candidateFinding("fragment-ladder", candidateFragmentLadders(text)) ??
      candidateFinding("repeated-opening", candidateRepeatedOpeningEvidence(messages, text))
    );
  }
  return null;
}

export function detectRoleplayCraftCandidate(
  messages: readonly JsonRecord[],
  candidate: string,
): CraftCandidateFinding | null {
  return detectRoleplayCraftCandidates(messages, candidate)[0] ?? null;
}

export function detectRoleplayCraftCandidates(
  messages: readonly JsonRecord[],
  candidate: string,
): CraftCandidateFinding[] {
  if (explicitlyRequestsRepetition(messages)) return [];
  const text = candidate.trim().slice(0, MAX_TURN_CHARS);
  if (!text) return [];
  return [
    candidateFinding("contrast-ladder", candidateContrastLadders(text)),
    candidateFinding("fragment-ladder", candidateFragmentLadders(text)),
    candidateFinding("repeated-opening", candidateRepeatedOpeningEvidence(messages, text)),
  ].filter((finding): finding is CraftCandidateFinding => finding !== null);
}

function tidyRepairWhitespace(value: string): string {
  return value
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function replaceExactOnce(source: string, before: string, after: string): string {
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + 1) >= 0) return source;
  return tidyRepairWhitespace(source.slice(0, start) + after + source.slice(start + before.length));
}

function repairContrastExcerpt(excerpt: string): string {
  const withoutInlinePivot = excerpt.replace(/\bnot\s+[^,.;!?]{1,120},\s*(?:but|just)\s+/giu, "");
  if (withoutInlinePivot !== excerpt) return withoutInlinePivot;

  const sentences = sentenceSegments(excerpt);
  const retained = sentences.filter((sentence) => !startsNegativeFragment(sentence));
  return retained.length > 0 ? retained.join(" ") : excerpt;
}

function repairFragmentExcerpt(excerpt: string): string {
  const withoutDoubledSomething = excerpt.replace(
    /\bsomething\s+([^,;.!?]{1,120}),([ \t]*)something\b/iu,
    "$1,$2something",
  );
  if (withoutDoubledSomething !== excerpt) return withoutDoubledSomething;

  const sentences = sentenceSegments(excerpt);
  return sentences.length >= 2 ? sentences[0]! : excerpt;
}

function wordsWithBounds(value: string): Array<{ normalized: string; start: number; end: number }> {
  return [...value.matchAll(/[\p{L}\p{N}']+/gu)].map((match) => ({
    normalized: (match[0] ?? "").toLocaleLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + (match[0]?.length ?? 0),
  }));
}

function repairRepeatedOpeningExcerpt(historical: string, candidate: string): string {
  const historicalComma = historical.indexOf(",");
  const candidateComma = candidate.indexOf(",");
  if (
    historicalComma > 0 &&
    historicalComma < 48 &&
    candidateComma > 0 &&
    candidateComma < 48 &&
    historical.slice(0, historicalComma).toLocaleLowerCase() === candidate.slice(0, candidateComma).toLocaleLowerCase()
  ) {
    const suffix = candidate.slice(candidateComma + 1).trimStart();
    return suffix ? suffix[0]!.toLocaleUpperCase() + suffix.slice(1) : candidate;
  }

  const historicalWords = wordsWithBounds(historical);
  const candidateWords = wordsWithBounds(candidate);
  let commonWords = 0;
  while (
    commonWords < historicalWords.length &&
    commonWords < candidateWords.length &&
    historicalWords[commonWords]!.normalized === candidateWords[commonWords]!.normalized
  ) {
    commonWords += 1;
  }
  if (commonWords < 4) return candidate;

  // Preserve the last shared word because it is usually the sentence subject
  // ("For a long moment, Mara ..."), while the earlier words are the stock lead-in.
  const firstRetainedWord = candidateWords[commonWords - 1]!;
  const suffix = candidate.slice(firstRetainedWord.start);
  return suffix ? suffix[0]!.toLocaleUpperCase() + suffix.slice(1) : candidate;
}

/**
 * Remove only the detected rhetorical scaffold from a Roleplay draft.
 * This is deliberately extractive: it never asks another model to rewrite the
 * response and never adds prose that the configured writer did not produce.
 */
export function repairRoleplayCraftCandidate(messages: readonly JsonRecord[], candidate: string): string {
  let repaired = candidate.trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const finding = detectRoleplayCraftCandidate(messages, repaired);
    if (!finding) break;

    const candidateEvidence = finding.evidence.find((excerpt) => repaired.includes(excerpt));
    if (!candidateEvidence) break;
    let replacement = candidateEvidence;
    if (finding.issue === "contrast-ladder") {
      replacement = repairContrastExcerpt(candidateEvidence);
    } else if (finding.issue === "fragment-ladder") {
      replacement = repairFragmentExcerpt(candidateEvidence);
    } else if (finding.issue === "repeated-opening") {
      const historicalEvidence = finding.evidence.find((excerpt) => excerpt !== candidateEvidence);
      if (historicalEvidence) {
        replacement = repairRepeatedOpeningExcerpt(historicalEvidence, candidateEvidence);
      }
    }

    const next = replaceExactOnce(repaired, candidateEvidence, replacement);
    if (!next || next === repaired) break;
    repaired = next;
  }
  return repaired || candidate;
}

function repairMindReadingCandidate(candidate: string): string {
  const direct = candidate.replace(
    /^\s*what you(?:'re| are) really (?:ask(?:ing)?|say(?:ing)?|mean(?:ing)?|want(?:ing)?|feel(?:ing)?) is whether\s+/iu,
    "",
  );
  if (direct !== candidate && direct.trim()) {
    const trimmed = direct.trim();
    return trimmed[0]!.toLocaleUpperCase() + trimmed.slice(1);
  }

  const sentences = sentenceSegments(candidate);
  if (
    sentences.length >= 2 &&
    /^you (?:don't|do not) (?:want|mean|feel|need)\b/iu.test(sentences[0]!) &&
    /^you (?:want|mean|feel|need)\b/iu.test(sentences[1]!)
  ) {
    return sentences.slice(1).join(" ");
  }
  return candidate;
}

/** Apply the same extractive repair policy to the small Conversation shapes. */
export function repairConversationCraftCandidate(messages: readonly JsonRecord[], candidate: string): string {
  const finding = detectConversationCraftCandidate(messages, candidate);
  if (!finding) return candidate;
  if (finding.issue === "mind-reading") return repairMindReadingCandidate(candidate);
  if (finding.issue === "forced-question") {
    const sentences = sentenceSegments(candidate);
    if (sentences.length > 1 && /\?\s*$/u.test(sentences.at(-1)!)) {
      return sentences.slice(0, -1).join(" ");
    }
  }
  return candidate;
}

const EXPLICIT_LONG_ROLEPLAY_REQUEST =
  /\b(?:write|give me|continue with|make it)\b[^.!?\n]{0,80}\b(?:long|longer|detailed|full scene|chapter|several (?:beats|paragraphs|pages))\b|\b(?:long|full|detailed) (?:scene|chapter|response|reply)\b/iu;

/**
 * End an already-complete short Roleplay stream instead of letting a detected
 * rhetorical ladder expand for hundreds more words. Explicit long-form requests
 * remain authoritative, and clean prose is never stopped by this policy.
 */
export function shouldStopRoleplayCraftStream(
  messages: readonly JsonRecord[],
  candidate: string,
  latestUserInput: string,
): boolean {
  if (EXPLICIT_LONG_ROLEPLAY_REQUEST.test(latestUserInput)) return false;
  if (wordCount(candidate) < 80) return false;
  const naturalBoundary =
    /\n\s*\n\s*$/u.test(candidate) || (wordCount(candidate) >= 220 && /[.!?]["')\]]?\s*$/u.test(candidate));
  return naturalBoundary && detectRoleplayCraftCandidate(messages, candidate) !== null;
}

export function craftShapeRepairGuidance(finding: CraftShapeFinding | CraftCandidateFinding): string {
  const evidence = finding.evidence
    .slice(0, 2)
    .map(
      (excerpt, index) =>
        `Prior assistant excerpt ${index + 1} (quoted evidence only): ${JSON.stringify(excerpt.slice(0, 320))}`,
    )
    .join("\n");
  return `${finding.directive}\n${evidence}`;
}
