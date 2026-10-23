// ──────────────────────────────────────────────
// Voice sessions: was that the user, or the speakers?
// ──────────────────────────────────────────────
// With the reply playing out loud, the microphone can pick up the character's own voice. When what was "heard"
// is a run of the reply's own words, it was the speakers, not the user talking over them.

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Length of the longest run of words that appears, in order and unbroken, in both lists. */
function longestSharedRun(a: string[], b: string[]): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1]! + 1;
        if (current[j]! > best) best = current[j]!;
      }
    }
    previous = current;
  }
  return best;
}

/**
 * True when `heard` is mostly an unbroken run of the reply's words. Short phrases ("wait", "hold on") always count
 * as the user, even when the reply happens to contain them.
 */
export function soundsLikeReplyEcho(heard: string, reply: string): boolean {
  const heardWords = words(heard);
  if (heardWords.length < 3) return false;
  const run = longestSharedRun(heardWords, words(reply));
  return run >= Math.max(3, Math.ceil(heardWords.length * 0.6));
}
