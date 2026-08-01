import { hiddenFromAi, readString, type JsonRecord } from "./runtime-records";

const MAX_ASSISTANT_TURNS = 8;
const MAX_TURN_CHARS = 8_000;

type CraftIssue = "contrast-ladder" | "fragment-ladder" | "mind-reading" | "forced-question" | "repeated-opening";

export interface CraftShapeFinding {
  issue: CraftIssue;
  directive: string;
  evidence: [string, string];
}

export interface CraftCandidateFinding {
  issue: CraftIssue;
  directive: string;
  evidence: [string, ...string[]];
}

const DIRECTIVES: Record<CraftIssue, string> = {
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

function visibleMessages(messages: readonly JsonRecord[]): JsonRecord[] {
  return messages.filter((message) => !hiddenFromAi(message)).slice(-32);
}

function assistantTurns(messages: readonly JsonRecord[]): string[] {
  return visibleMessages(messages)
    .filter((message) => readString(message.role).trim() === "assistant")
    .map((message) => readString(message.content).trim().slice(0, MAX_TURN_CHARS))
    .filter(Boolean)
    .slice(-MAX_ASSISTANT_TURNS);
}

function recentUserText(messages: readonly JsonRecord[]): string {
  return visibleMessages(messages)
    .filter((message) => readString(message.role).trim() === "user")
    .slice(-4)
    .map((message) => readString(message.content).trim())
    .filter(Boolean)
    .join("\n");
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/gu) ?? []).map((part) => part.trim()).filter(Boolean);
}

function wordCount(value: string): number {
  return value.match(/[\p{L}\p{N}']+/gu)?.length ?? 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function startsNegative(value: string): boolean {
  return /^(?:not|no|nothing)\b/iu.test(value);
}

function contrastLadders(turn: string, candidate = false): string[] {
  const parts = sentences(turn);
  const found: string[] = [];
  for (let start = 0; start < parts.length; start += 1) {
    for (let span = 3; span <= 5 && start + span <= parts.length; span += 1) {
      const window = parts.slice(start, start + span);
      const negatives = window.filter(startsNegative);
      if (
        negatives.length >= 2 &&
        (candidate || window.some((part) => /^(?:just|only|simply|enough\b)/iu.test(part))) &&
        (!candidate || negatives.some((part) => wordCount(part) >= 2))
      ) {
        found.push(window.join(" "));
        break;
      }
    }
  }
  for (const part of parts) {
    if (/\bnot\b[^.!?\n]{1,120}\b(?:but|just)\b/iu.test(part)) found.push(part);
  }
  return unique(found);
}

function fragmentLadders(turn: string, candidate = false): string[] {
  const parts = sentences(turn);
  const found: string[] = [];
  for (const fragmentCount of candidate ? [3, 2] : [3]) {
    for (let index = 0; index + fragmentCount < parts.length; index += 1) {
      const fragments = parts.slice(index, index + fragmentCount);
      if (
        fragments.every((part) => wordCount(part) >= 1 && wordCount(part) <= 4) &&
        wordCount(parts[index + fragmentCount]!) >= (fragmentCount === 2 ? 6 : 4)
      ) {
        found.push(fragments.join(" "));
      }
    }
  }
  if (candidate) {
    for (const part of parts) {
      if (/\bsomething\b[^.!?\n]{1,120}\bsomething\b/iu.test(part)) found.push(part);
    }
  }
  return unique(found).filter((excerpt) => contrastLadders(excerpt, candidate).length === 0);
}

function mindReading(turn: string): string[] {
  const parts = sentences(turn);
  const found: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (
      /\bwhat you(?:'re| are) really (?:ask(?:ing)?|say(?:ing)?|mean(?:ing)?|want(?:ing)?|feel(?:ing)?)\b/iu.test(part)
    ) {
      found.push(part);
    }
    const next = parts[index + 1];
    if (
      next &&
      /\byou (?:don't|do not) (?:want|mean|feel|need)\b/iu.test(part) &&
      /\byou (?:want|mean|feel|need)\b/iu.test(next)
    ) {
      found.push(`${part} ${next}`);
    }
  }
  return unique(found);
}

function requestsRepetition(messages: readonly JsonRecord[]): boolean {
  const text = recentUserText(messages);
  return (
    /\b(?:use|write|keep|make|continue)\b[^.!?\n]{0,80}\b(?:repeat(?:ed|ing)?|repetition|refrain|chant|litany|anaphora|parallel phrasing)\b/iu.test(
      text,
    ) || /\brepeat\b[^.!?\n]{0,60}\b(?:ritual|line|phrase|wording)\b/iu.test(text)
  );
}

function requestsQuestions(messages: readonly JsonRecord[]): boolean {
  const text = recentUserText(messages);
  if (/\b(?:do not|don't|stop|quit)\s+(?:asking?|adding)\b[^.!?\n]{0,40}\bquestions?\b/iu.test(text)) return false;
  return (
    /\b(?:keep|please|can you|could you|would you|i want you to|go ahead and)\b[^.!?\n]{0,60}\bask(?:ing)?\b/iu.test(
      text,
    ) || /\b(?:interview|quiz)\s+me\b/iu.test(text)
  );
}

function firstPerTurn(turns: readonly string[], detector: (turn: string) => string[]): string[] {
  return turns.map((turn) => detector(turn)[0] ?? "").filter(Boolean);
}

function repeatedOpening(turns: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const turn of turns) {
    for (const part of sentences(turn)) {
      const words = part.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
      if (words.length < 7) continue;
      const key = words.slice(0, 4).join(" ");
      if (key.length < 16) continue;
      const prior = seen.get(key);
      if (prior && prior !== part) return [prior, part];
      seen.set(key, part);
    }
  }
  return [];
}

function historyFinding(issue: CraftIssue, evidence: readonly string[]): CraftShapeFinding | null {
  const excerpts = unique(evidence);
  return excerpts.length >= 2 ? { issue, directive: DIRECTIVES[issue], evidence: [excerpts[0]!, excerpts[1]!] } : null;
}

function candidateFinding(issue: CraftIssue, evidence: readonly string[]): CraftCandidateFinding | null {
  const excerpts = unique(evidence).slice(0, 2);
  return excerpts.length ? { issue, directive: DIRECTIVES[issue], evidence: excerpts as [string, ...string[]] } : null;
}

function repeatedOpeningCandidate(messages: readonly JsonRecord[], candidate: string): string[] {
  const evidence = repeatedOpening([...assistantTurns(messages), candidate]);
  return evidence.some((excerpt) => candidate.includes(excerpt)) ? evidence : [];
}

export function detectConversationCraftShape(messages: readonly JsonRecord[]): CraftShapeFinding | null {
  const turns = assistantTurns(messages);
  const restatement = historyFinding("mind-reading", firstPerTurn(turns, mindReading));
  if (restatement) return restatement;
  const trailing = turns.slice(-3);
  if (!requestsQuestions(messages) && trailing.length === 3 && trailing.every((turn) => /\?\s*$/u.test(turn))) {
    return historyFinding("forced-question", trailing);
  }
  return requestsRepetition(messages)
    ? null
    : (historyFinding(
        "contrast-ladder",
        firstPerTurn(turns, (turn) => contrastLadders(turn)),
      ) ??
        historyFinding(
          "fragment-ladder",
          firstPerTurn(turns, (turn) => fragmentLadders(turn)),
        ) ??
        historyFinding("repeated-opening", repeatedOpening(turns)));
}

export function detectRoleplayCraftShape(messages: readonly JsonRecord[]): CraftShapeFinding | null {
  if (requestsRepetition(messages)) return null;
  const turns = assistantTurns(messages);
  return (
    historyFinding(
      "contrast-ladder",
      firstPerTurn(turns, (turn) => contrastLadders(turn)),
    ) ??
    historyFinding(
      "fragment-ladder",
      firstPerTurn(turns, (turn) => fragmentLadders(turn)),
    ) ??
    historyFinding("repeated-opening", repeatedOpening(turns))
  );
}

export function detectConversationCraftCandidate(
  messages: readonly JsonRecord[],
  candidate: string,
): CraftCandidateFinding | null {
  const text = candidate.trim().slice(0, MAX_TURN_CHARS);
  if (!text) return null;
  const restatement = candidateFinding("mind-reading", mindReading(text));
  if (restatement) return restatement;
  const priorQuestions = assistantTurns(messages)
    .slice(-2)
    .filter((turn) => /\?\s*$/u.test(turn));
  if (!requestsQuestions(messages) && /\?\s*$/u.test(text) && priorQuestions.length === 2) {
    return candidateFinding("forced-question", [text]);
  }
  return requestsRepetition(messages)
    ? null
    : (candidateFinding("contrast-ladder", contrastLadders(text, true)) ??
        candidateFinding("fragment-ladder", fragmentLadders(text, true)) ??
        candidateFinding("repeated-opening", repeatedOpeningCandidate(messages, text)));
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
  if (requestsRepetition(messages)) return [];
  const text = candidate.trim().slice(0, MAX_TURN_CHARS);
  if (!text) return [];
  return [
    candidateFinding("contrast-ladder", contrastLadders(text, true)),
    candidateFinding("fragment-ladder", fragmentLadders(text, true)),
    candidateFinding("repeated-opening", repeatedOpeningCandidate(messages, text)),
  ].filter((entry): entry is CraftCandidateFinding => entry !== null);
}

function tidy(value: string): string {
  return value
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n|\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function replaceOnce(source: string, before: string, after: string): string {
  const start = source.indexOf(before);
  return start < 0 || source.indexOf(before, start + 1) >= 0
    ? source
    : tidy(source.slice(0, start) + after + source.slice(start + before.length));
}

function repairRepeatedOpening(historical: string, candidate: string): string {
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
  const oldWords = [...historical.matchAll(/[\p{L}\p{N}']+/gu)];
  const newWords = [...candidate.matchAll(/[\p{L}\p{N}']+/gu)];
  let shared = 0;
  while (
    shared < oldWords.length &&
    shared < newWords.length &&
    oldWords[shared]![0].toLocaleLowerCase() === newWords[shared]![0].toLocaleLowerCase()
  ) {
    shared += 1;
  }
  if (shared < 4) return candidate;
  const suffix = candidate.slice(newWords[shared - 1]!.index);
  return suffix[0]!.toLocaleUpperCase() + suffix.slice(1);
}

/** Remove only exact detected scaffold; never ask another model or invent prose. */
export function repairRoleplayCraftCandidate(messages: readonly JsonRecord[], candidate: string): string {
  let repaired = candidate.trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const finding = detectRoleplayCraftCandidate(messages, repaired);
    const excerpt = finding?.evidence.find((value) => repaired.includes(value));
    if (!finding || !excerpt) break;
    let replacement = excerpt;
    if (finding.issue === "contrast-ladder") {
      replacement = excerpt.replace(/\bnot\s+[^,.;!?]{1,120},\s*(?:but|just)\s+/giu, "");
      if (replacement === excerpt)
        replacement = sentences(excerpt)
          .filter((part) => !startsNegative(part))
          .join(" ");
    } else if (finding.issue === "fragment-ladder") {
      replacement = excerpt.replace(/\bsomething\s+([^,;.!?]{1,120}),([ \t]*)something\b/iu, "$1,$2something");
      if (replacement === excerpt) replacement = sentences(excerpt)[0] ?? excerpt;
    } else if (finding.issue === "repeated-opening") {
      const historical = finding.evidence.find((value) => value !== excerpt);
      if (historical) replacement = repairRepeatedOpening(historical, excerpt);
    }
    const next = replaceOnce(repaired, excerpt, replacement);
    if (!next || next === repaired) break;
    repaired = next;
  }
  return repaired || candidate;
}

export function repairConversationCraftCandidate(messages: readonly JsonRecord[], candidate: string): string {
  const finding = detectConversationCraftCandidate(messages, candidate);
  if (finding?.issue === "mind-reading") {
    const direct = candidate.replace(
      /^\s*what you(?:'re| are) really (?:ask(?:ing)?|say(?:ing)?|mean(?:ing)?|want(?:ing)?|feel(?:ing)?) is whether\s+/iu,
      "",
    );
    if (direct !== candidate && direct.trim()) {
      const trimmed = direct.trim();
      return trimmed[0]!.toLocaleUpperCase() + trimmed.slice(1);
    }
    const parts = sentences(candidate);
    if (/^you (?:don't|do not) (?:want|mean|feel|need)\b/iu.test(parts[0] ?? "")) return parts.slice(1).join(" ");
  }
  if (finding?.issue === "forced-question") {
    const parts = sentences(candidate);
    if (parts.length > 1) return parts.slice(0, -1).join(" ");
  }
  return candidate;
}

const EXPLICIT_LONG_REQUEST =
  /\b(?:write|give me|continue with|make it)\b[^.!?\n]{0,80}\b(?:long|longer|detailed|full scene|chapter|several (?:beats|paragraphs|pages))\b|\b(?:long|full|detailed) (?:scene|chapter|response|reply)\b/iu;

export function shouldStopRoleplayCraftStream(
  messages: readonly JsonRecord[],
  candidate: string,
  latestUserInput: string,
): boolean {
  if (EXPLICIT_LONG_REQUEST.test(latestUserInput) || wordCount(candidate) < 80) return false;
  const boundary =
    /\n\s*\n\s*$/u.test(candidate) || (wordCount(candidate) >= 220 && /[.!?]["')\]]?\s*$/u.test(candidate));
  return boundary && detectRoleplayCraftCandidate(messages, candidate) !== null;
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
