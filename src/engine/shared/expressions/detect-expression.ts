// ──────────────────────────────────────────────
// Expression from text: the keyword fallback for sprite expressions
// ──────────────────────────────────────────────
// When the Expression Engine hasn't picked an expression (it isn't on, or hasn't answered yet), sprites follow the
// mood their character's text reads as. Returns an Expression Engine expression name, "neutral" when nothing matches.

const EXPRESSION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["angry", /\b(anger|angry|furious|rage|yells?|shouts?|snarls?|growls?|seeth)/i],
  ["sad", /\b(sad|sorrow|cry|cries|crying|tears|weep|sob|mourn|grief|melanchol)/i],
  ["happy", /\b(happy|joy|laugh|smile|smiles|grin|grins|cheer|delight|beam|beaming|giggl)/i],
  ["surprised", /\b(surpris|shock|astonish|gasp|gasps|wide.?eye|startle|stun)/i],
  ["scared", /\b(scare|fear|afraid|terrif|frighten|tremble|trembling|shiver|panic)/i],
  ["embarrassed", /\b(embarrass|blush|blushes|flustered|sheepish|shy|avert)/i],
  ["love", /\b(love|adore|affection|heart|kiss|embrace|cherish)/i],
  ["thinking", /\b(think|ponder|consider|contemplat|muse|hmm|wonder)/i],
  ["laughing", /\b(laugh|laughing|laughter|haha|LOL|chuckle|cackle|snicker|giggle)/i],
  ["worried", /\b(worr|anxious|nervous|uneasy|fret|concern|dread)/i],
  ["disgusted", /\b(disgust|repuls|revolt|gross|nausea|sicken)/i],
  ["smirk", /\b(smirk|sly|mischiev|devious|wink|tease|teasing)/i],
  ["crying", /\b(crying|cried|weeping|tears stream|sobbing)/i],
  ["determined", /\b(determin|resolv|steadfast|unwaver|resolute|clench)/i],
  ["hurt", /\b(hurt|pain|wound|wince|grimace|ache|suffer)/i],
];

/** Simple keyword-based expression detection from message text. */
export function detectExpression(text: string): string {
  const lower = text.toLowerCase();
  for (const [expression, regex] of EXPRESSION_PATTERNS) {
    if (regex.test(lower)) return expression;
  }
  return "neutral";
}
