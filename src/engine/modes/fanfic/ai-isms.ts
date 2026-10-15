// ──────────────────────────────────────────────
// Fanfic: spot the prose habits that make a chapter read as machine-written
// ──────────────────────────────────────────────
import { stripFanficChapterHeading } from "./prompts";

export type FanficAiIsmId =
  | "negation_beat"
  | "reframe"
  | "wry_which"
  | "simply"
  | "doubled_intensifier"
  | "stock_phrase"
  | "echo_openers"
  | "then_chain"
  | "em_dash";

interface FanficAiIsmRule {
  id: FanficAiIsmId;
  label: string;
  /** How to fix it, phrased for a rewrite instruction. */
  advice: string;
}

export const FANFIC_AI_ISM_RULES: Record<FanficAiIsmId, FanficAiIsmRule> = {
  negation_beat: {
    id: "negation_beat",
    label: 'Short "He did not…" beats',
    advice: "Say what the character does instead of stacking short sentences about what they did not do.",
  },
  reframe: {
    id: "reframe",
    label: '"It wasn\'t X. It was Y." reframes',
    advice: "State the thing directly instead of setting up a wrong version to knock down.",
  },
  wry_which: {
    id: "wry_which",
    label: 'Wry ", which was worse" asides',
    advice: "Cut the narrator's tacked-on commentary clauses; let the moment land by itself.",
  },
  simply: {
    id: "simply",
    label: '"Simply" / "merely"',
    advice: 'Drop "simply"/"merely" and the "he had simply arrived" move.',
  },
  doubled_intensifier: {
    id: "doubled_intensifier",
    label: '"Very X and very Y"',
    advice: "Use one precise word instead of a doubled intensifier.",
  },
  stock_phrase: {
    id: "stock_phrase",
    label: "Stock phrases",
    advice: "Replace stock phrases with something specific to these characters and this scene.",
  },
  echo_openers: {
    id: "echo_openers",
    label: "Back-to-back sentences that start the same way",
    advice: "Break up runs of sentences that open with the same words; vary the rhythm naturally.",
  },
  then_chain: {
    id: "then_chain",
    label: '"Then… Then…" chains',
    advice: 'Fold "Then X. Then Y." chains into normal sentences.',
  },
  em_dash: {
    id: "em_dash",
    label: "Em dashes",
    advice: "Use far fewer em dashes; prefer commas, periods, or parentheses.",
  },
};

const NEGATION =
  /\b(?:did not|didn't|does not|doesn't|had not|hadn't|was not|wasn't|could not|couldn't|would not|wouldn't)\b/i;
const REFRAME =
  /\b(?:wasn't|was not|isn't|is not|weren't|were not)\b[^.!?]{1,60}[.!?]["”]?\s+(?:It|This|That|He|She|They)\s+(?:was|were|is)\b/g;
const WRY_WHICH = /,\s+which\s+(?:was|is|seemed|somehow|made|meant|felt|he|she|they|it)\b/gi;
const SIMPLY = /\b(?:simply|merely)\b/gi;
const DOUBLED = /\bvery \w+ and very \w+/gi;
const STOCK_PHRASES = [
  /breath (?:he|she|they|I) didn't know/i,
  /\bsomething (?:shifted|changed) (?:in|between)\b/i,
  /\bthe weight of (?:it|his|her|their|the words|what)\b/i,
  /\b(?:for|after) a long moment\b/i,
  /\bin that moment\b/i,
  /\bcouldn't help but\b/i,
  /\bthe ghost of a (?:smile|laugh|grin)\b/i,
  /\ba flicker of\b/i,
  /\b(?:let out|released) a breath\b/i,
  /\bdespite (?:himself|herself|themselves)\b/i,
  /\bunspoken\b/i,
  /\bpalpable\b/i,
  /\ba testament to\b/i,
  /\bthe air (?:was )?(?:thick|heavy) with\b/i,
  /\bif (?:he|she|they) (?:was|were) being honest\b/i,
  /\bsomething (?:like|close to) \w+\b/i,
];
const EM_DASH = /—/g;
const SENTENCE = /[^.!?…]+(?:[.!?…]+["”’)]*|$)/g;

export interface FanficAiIsmFinding {
  id: FanficAiIsmId;
  label: string;
  advice: string;
  count: number;
  examples: string[];
}

export interface FanficAiIsmReport {
  words: number;
  /** Weighted hits per 1,000 words. */
  score: number;
  findings: FanficAiIsmFinding[];
}

/** Score at which a chapter is worth offering a clean-up pass. */
export const FANFIC_AI_ISM_CLEANUP_SCORE = 10;

function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(SENTENCE) ?? [])
    .map((sentence) => sentence.replace(/^[\s"“*_]+/, "").trim())
    .filter((sentence) => /\w/.test(sentence));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}…` : clean;
}

function openerKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^a-z' ]/g, "")
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

/**
 * Counts the habits that make fiction read as model-written. Each hit keeps a short example so a
 * rewrite can be pointed at the exact lines. Em dashes only count past a light-use allowance.
 */
export function detectFanficAiIsms(chapterText: string): FanficAiIsmReport {
  const text = stripFanficChapterHeading(chapterText);
  const words = wordCount(text);
  const sentences = sentencesOf(text);
  const hits = new Map<FanficAiIsmId, string[]>();
  const add = (id: FanficAiIsmId, example: string) => {
    const list = hits.get(id) ?? [];
    list.push(clip(example));
    hits.set(id, list);
  };

  sentences.forEach((sentence, index) => {
    if (NEGATION.test(sentence) && wordCount(sentence) <= 10) add("negation_beat", sentence);
    if (/^then\b/i.test(sentence)) add("then_chain", sentence);
    for (const pattern of STOCK_PHRASES) if (pattern.test(sentence)) add("stock_phrase", sentence);
    const previous = sentences[index - 1];
    if (previous && openerKey(sentence).includes(" ") && openerKey(sentence) === openerKey(previous)) {
      add("echo_openers", `${previous} ${sentence}`);
    }
  });
  for (const [id, pattern] of [
    ["reframe", REFRAME],
    ["wry_which", WRY_WHICH],
    ["simply", SIMPLY],
    ["doubled_intensifier", DOUBLED],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const previousStop = text.lastIndexOf(". ", match.index);
      const sentenceStart = previousStop < 0 ? lineStart : Math.max(lineStart, previousStop + 2);
      const after = text.slice(match.index + match[0].length).search(/[.!?\n]/);
      const end = after < 0 ? text.length : match.index + match[0].length + after + 1;
      add(id, text.slice(sentenceStart, end));
    }
  }
  const dashes = text.match(EM_DASH)?.length ?? 0;
  const allowance = Math.ceil((words / 1000) * 3);
  for (let index = 0; index < dashes - allowance; index += 1) add("em_dash", "—");

  const findings = (Object.keys(FANFIC_AI_ISM_RULES) as FanficAiIsmId[])
    .map((id) => {
      const examples = hits.get(id) ?? [];
      return { ...FANFIC_AI_ISM_RULES[id], count: examples.length, examples: id === "em_dash" ? [] : examples };
    })
    .filter((finding) => finding.count > 0)
    .sort((left, right) => right.count - left.count);
  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  return { words, score: words > 0 ? Math.round((total / words) * 10000) / 10 : 0, findings };
}

/** Rewrite notes that point the model at the exact habits it fell into, keeping story and length intact. */
export function buildFanficAiIsmCleanupNotes(report: FanficAiIsmReport): string {
  const lines = [
    "Clean up the prose so it reads like a person wrote it. Keep the plot, every beat and joke, the dialogue's meaning, the point of view, and the length. Only change how sentences are built.",
  ];
  for (const finding of report.findings) {
    const examples = finding.examples.slice(0, 3).map((example) => `"${example}"`);
    lines.push(`- ${finding.advice}${examples.length > 0 ? ` For example: ${examples.join("; ")}` : ""}`);
  }
  lines.push("Don't swap one habit for another (no new stock phrases, no new repeated sentence shapes).");
  return lines.join("\n");
}
