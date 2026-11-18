// Small text rules shared by scene planning, summaries and write-backs.

const SENTENCE_BOUNDARY = /(?<=[.!?…]["'”’)\]]*)\s+/;
const ENDS_WITH_SENTENCE_MARK = /[.!?…]["'”’)\]]*$/;
// Labels a model (or a pasted transcript) puts in front of text: "Summary:", "Scene summary:", or a role word.
const LEADING_LABEL =
  /^\s*(?:\*\*)?(?:scene summary|summary|user|assistant|narrator|system|model|ai|character|persona)(?:\*\*)?\s*:(?:\*\*)?\s*/i;
const SCENE_NAME_PREFIX = /^\s*scene\s*:\s*/i;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Turns `\n` and `\t` written out as text into real line breaks and tabs. */
export function unescapeWrittenBreaks(text: string): string {
  return text.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t");
}

/** Removes leading summary and speaker labels, however many are stacked. */
export function stripLeadingLabels(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(LEADING_LABEL, "");
    if (next === current) return current;
    current = next;
  }
}

/**
 * Keeps text within `max` characters: cut after the last sentence that fits (when that keeps at least half), else at
 * the last word that fits, followed by "...".
 */
export function capAtSentenceOrWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  let sentenceEnd = -1;
  for (const match of window.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)) {
    sentenceEnd = (match.index ?? 0) + match[0].length;
  }
  if (sentenceEnd >= max / 2) return window.slice(0, sentenceEnd).trimEnd();
  const room = window.slice(0, Math.max(0, max - 3));
  const lastSpace = room.search(/\s\S*$/);
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut.trimEnd()}...`;
}

export function countSentences(text: string): number {
  return text
    .trim()
    .split(SENTENCE_BOUNDARY)
    .filter((segment) => /[\p{L}\p{N}]/u.test(segment)).length;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function withFinalPeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || ENDS_WITH_SENTENCE_MARK.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

/** The scene's name without its "Scene:" prefix, for messages and memories that say "scene" already. */
export function sceneTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(SCENE_NAME_PREFIX, "").trim() || trimmed;
}

/** YYYY-MM-DD of an ISO time. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}
