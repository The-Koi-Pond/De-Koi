/**
 * Spots an explicit time skip the user wrote into their own Roleplay message ("*Three days later*",
 * "[Time skip: a week]", "Skip to the next morning"). Deliberately narrow: a phrase only counts at
 * the start of a line (after emphasis, brackets or an OOC tag), except the words "time skip"
 * themselves, which count anywhere unless negated. Dialogue lines (starting with a quote) never
 * count. A miss costs nothing, since the hourglass still works; a false hit nags the user.
 */

export interface DetectedTimeSkip {
  /** How much time passes, in the user's words where they gave it ("three days", "until the next morning"). */
  elapsed: string;
  /** The phrase that matched, as written, for the offer's wording. */
  phrase: string;
}

const QUANTITY =
  "(?:\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\\s+few|a\\s+couple(?:\\s+of)?|several|some|many)";
const UNIT = "(?:minute|hour|day|night|week|fortnight|month|season|year)s?";
const SPAN = `${QUANTITY}\\s+${UNIT}`;
const NEXT_PERIOD = "(?:the\\s+)?(?:next|following)\\s+(?:morning|day|afternoon|evening|night|week|month|season|year)";

/** Markdown emphasis, quote marks for narration blocks, brackets, dashes and an OOC tag before the phrase. */
const LINE_LEAD = /^(?:[\s*_~>#([{\-–—]|ooc\s*:)*/i;

/** Word end that treats a markdown underscore as punctuation (`\b` counts `_` as a letter). */
const END = "(?![a-z0-9])";

const LATER = new RegExp(`^(${SPAN})\\s+later${END}`, "i");
const NEXT = new RegExp(`^(${NEXT_PERIOD})${END}`, "i");
const SKIP_TO =
  /^(?:let'?s\s+|we\s+)?(?:skip|fast[\s-]?forward)\s+(?:ahead\s+)?(?:to|until|till)\s+([^.!?*_\])\n]{2,60})/i;
const SKIP_SPAN = new RegExp(
  `^(?:let'?s\\s+|we\\s+)?(?:skip|fast[\\s-]?forward)\\s+(?:ahead\\s+)?(${SPAN})${END}`,
  "i",
);
const TIME_SKIP = /(?<![a-z0-9])time[\s-]?skip(?:ped)?(?![a-z0-9])/i;
const TIME_SKIP_TAIL = /^\s*(?:[:\-–—]\s*|\s+(?:of|to|until|till|by)\s+)([^.!?*_\])\n]{2,60})/i;
/** "no time skip", "not do a time skip", "without any time skip": a negation up to two words back. */
const NEGATION = /\b(?:no|not|don'?t|without|never|before|avoid)\b(?:\s+[a-z']+){0,2}\s*$/i;

function clean(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;:]+$/, "");
}

function lower(text: string): string {
  return clean(text).toLowerCase();
}

function untilPhrase(target: string): string {
  const value = lower(target);
  return value.startsWith("until ") ? value : `until ${value}`;
}

function detectInLine(rawLine: string): DetectedTimeSkip | null {
  const line = rawLine.replace(LINE_LEAD, "");
  if (!line || /^["“”'‘]/.test(line)) return null;

  const later = LATER.exec(line);
  if (later) return { elapsed: lower(later[1]!), phrase: clean(later[0]) };

  const skipSpan = SKIP_SPAN.exec(line);
  if (skipSpan) return { elapsed: lower(skipSpan[1]!), phrase: clean(skipSpan[0]) };

  const skipTo = SKIP_TO.exec(line);
  if (skipTo) return { elapsed: untilPhrase(skipTo[1]!), phrase: clean(skipTo[0]) };

  const next = NEXT.exec(line);
  if (next) return { elapsed: untilPhrase(next[1]!), phrase: clean(next[0]) };

  const timeSkip = TIME_SKIP.exec(line);
  const before = timeSkip ? line.slice(0, timeSkip.index) : "";
  // Inside dialogue ("Should we time skip?" she asks) it is a character talking, not the user skipping.
  const insideQuote = (before.match(/["“”]/g)?.length ?? 0) % 2 === 1;
  if (timeSkip && !insideQuote && !NEGATION.test(before)) {
    const tail = TIME_SKIP_TAIL.exec(line.slice(timeSkip.index + timeSkip[0].length));
    const amount = tail ? clean(tail[1]!) : "";
    const elapsed = !amount ? "" : /^(?:to|until|till)\b/i.test(tail![0].trim()) ? untilPhrase(amount) : lower(amount);
    return { elapsed, phrase: clean(timeSkip[0] + (tail ? tail[0] : "")) };
  }
  return null;
}

/** Returns the first explicit time skip in the message, or null. */
export function detectExplicitTimeSkip(text: string): DetectedTimeSkip | null {
  if (typeof text !== "string" || !text.trim()) return null;
  for (const line of text.split(/\r?\n/)) {
    const hit = detectInLine(line);
    if (hit) {
      const elapsed = hit.elapsed.replace(/\s+(?:please|pls|plz)$/i, "");
      return { elapsed: elapsed.slice(0, 80), phrase: hit.phrase.slice(0, 120) };
    }
  }
  return null;
}
