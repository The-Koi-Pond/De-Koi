// ──────────────────────────────────────────────
// Character card linter: catch the predictable breakages in imported cards
// ──────────────────────────────────────────────
// Every rule is a line-by-line rewrite. A finding exists only when its rewrite
// changes something, so the preview the user sees is exactly what "Fix it" saves.

export type CardLintRule = "mojibake" | "speaker_prefix" | "legacy_scaffolding" | "ai_lines";

export type CardLintField =
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "alternate_greetings"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions"
  | "creator_notes";

export interface CardLintEdit {
  before: string;
  after: string;
}

export interface CardLintFinding {
  id: string;
  rule: CardLintRule;
  field: CardLintField;
  title: string;
  why: string;
  edits: CardLintEdit[];
}

type CardData = Record<string, unknown>;
/** Rewrites one line of `text`; null drops it. `first` is true for the text's first non-blank line. */
type LineFix = (line: string, name: string, first: boolean, text: string) => string | null;

const FIELD_LABELS: Record<CardLintField, string> = {
  name: "Name",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "First message",
  alternate_greetings: "Alternate greetings",
  mes_example: "Example messages",
  system_prompt: "System prompt",
  post_history_instructions: "Post-history instructions",
  creator_notes: "Creator notes",
};

const MODEL_FIELDS: CardLintField[] = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "alternate_greetings",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
];
const GREETINGS: CardLintField[] = ["first_mes", "alternate_greetings"];

export function cardLintFieldLabel(field: CardLintField): string {
  return FIELD_LABELS[field];
}

// ── Mojibake: UTF-8 bytes that were read as Windows-1252 ("â€™" for "’") ──

// Windows-1252 characters for bytes 0x80-0x9F; the 5 undefined bytes stay as C1 controls.
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
let utf8: TextDecoder | null = null;

function cp1252Byte(char: string | undefined): number {
  if (!char) return -1;
  const code = char.charCodeAt(0);
  if (code >= 0xa0 && code <= 0xff) return code;
  const high = CP1252_HIGH.indexOf(char);
  return high >= 0 ? 0x80 + high : -1;
}

const isContinuation = (byte: number) => byte >= 0x80 && byte <= 0xbf;

export function repairMojibake(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const lead = text.charCodeAt(i);
    if (lead < 0xc2 || lead > 0xf4) {
      out += text[i];
      continue;
    }
    const need = lead < 0xe0 ? 1 : lead < 0xf0 ? 2 : 3;
    const bytes = [lead];
    for (let k = 1; k <= need && isContinuation(cp1252Byte(text[i + k])); k += 1) bytes.push(cp1252Byte(text[i + k]));
    if (bytes.length === need + 1) {
      try {
        utf8 ??= new TextDecoder("utf-8", { fatal: true });
        out += utf8.decode(new Uint8Array(bytes));
        i += need;
        continue;
      } catch {
        // Not a valid UTF-8 sequence, so the characters were meant literally.
      }
    }
    // "â€" + a dropped 0x9D byte is a closing curly quote that lost its last byte.
    if (lead === 0xe2 && bytes.length === 2 && bytes[1] === 0x80) {
      out += "”";
      i += 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

// ── Greeting speaker prefixes ("{{char}}: Hello") ──

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function speakerPrefix(name: string): RegExp {
  const names = ["\\{\\{char\\}\\}", "<bot>"];
  if (name.trim()) names.push(escapeRegExp(name.trim()));
  return new RegExp(`^(\\s*)(?:${names.join("|")})[ \\t]*:[ \\t]*`, "i");
}

const USER_TURN = /^\s*(?:\{\{user\}\}|<user>)\s*:/im;
const ANY_LABEL = /^\s*[^\s*"“([][^:\n]{0,40}:\s/;

/** True when every labelled line belongs to the character, like a texting greeting with one label per bubble. */
function onlyOwnLabels(text: string, name: string): boolean {
  const own = speakerPrefix(name);
  return text.split("\n").every((line) => !ANY_LABEL.test(line) || own.test(line));
}

// ── Old Claude-2 scaffolding ──

const TURN_MARKER = /^(\s*)(Human|Assistant)[ \t]*:/;
const JAILBREAK_NOTE =
  /[[(][^\])\n]{0,400}?(?:ethical protocols|regardless of how the (?:chat )?context progresses|content (?:policy|policies|guidelines|filters?)|Anthropic|OpenAI|ignore (?:all )?(?:previous|prior) instructions|without (?:any )?(?:filters|restrictions|censorship)|not bound by)[^\])\n]{0,400}[\])]/gi;

function fixScaffolding(line: string): string | null {
  const next = line
    .replace(
      TURN_MARKER,
      (_m, indent: string, role: string) => `${indent}${role === "Human" ? "{{user}}" : "{{char}}"}:`,
    )
    .replace(JAILBREAK_NOTE, "");
  if (next === line) return line;
  return next.trim() ? next.replace(/[ \t]{2,}/g, " ").trimEnd() : null;
}

// ── AI-sounding lines the model will copy ──

const AI_PHRASES = [
  /\b(?:eyes|gaze)\s+(?:sparkl|glint|gleam|twinkl|danc)\w*\s+with\s+(?:mischief|amusement|curiosity|desire|playfulness)/i,
  /\b(?:glint|twinkle|sparkle|spark|gleam)\s+of\s+(?:mischief|amusement|playfulness)/i,
  /\b(?:mischievous|predatory|wicked|playful)\s+glint\b/i,
  /\bbarely above a whisper\b/i,
  /\bshivers?\s+(?:down|up)\s+(?:your|his|her|their|my)\s+spine\b/i,
  /\bministrations\b/i,
  /\ba (?:mix|mixture|blend) of (?:\w+ )?(?:amusement|curiosity|annoyance|concern|fear|excitement|desire|lust|anticipation|nervousness|embarrassment|surprise|confusion|affection|irritation|admiration|mischief)\b/i,
  /\b(?:voice|tone|words)\s+(?:dripping|laced|thick|heavy)\s+with\b/i,
  /\bmaybe,? just maybe\b/i,
  /\bI don'?t bite\b/i,
  /\bsomething (?:uniquely|distinctly) (?:him|her|them|his|hers|theirs|you|yours|\{\{char\}\})/i,
  /\bwith a (?:sly|playful|mischievous|knowing|wicked) (?:grin|smile|smirk)\b/i,
  /\bsmirk(?:s|ed|ing)?\s+(?:playfully|mischievously|knowingly|devilishly)\b/i,
  /\bthe air (?:is |was )?(?:thick|heavy|charged) with\b/i,
  /\b(?:bites?|biting|bit) (?:her|his|their|my) (?:lower )?lip\b/i,
];

const SEGMENT = /\*[^*]*\*|"[^"]*"|“[^”]*”|[^*"“]+|[*"“]/g;
const SENTENCE = /[^.!?…]*[.!?…]+\s*|[^.!?…]+$/g;

function dropAiSentences(text: string): string {
  return (text.match(SENTENCE) ?? [text]).filter((sentence) => !AI_PHRASES.some((p) => p.test(sentence))).join("");
}

function fixAiLine(line: string, name: string): string | null {
  if (!AI_PHRASES.some((p) => p.test(line))) return line;
  const prefix = line.match(speakerPrefix(name)) ?? line.match(/^\s*\{\{user\}\}\s*:\s*/i);
  const head = prefix?.[0] ?? "";
  const segments = line.slice(head.length).match(SEGMENT) ?? [];
  const kept = segments.map((segment) => {
    const open = segment.length > 1 && /^[*"“]/.test(segment) ? segment[0]! : "";
    const close = open ? segment.at(-1)! : "";
    const inner = open ? segment.slice(1, -1) : segment;
    if (!AI_PHRASES.some((p) => p.test(inner))) return segment;
    const rest = dropAiSentences(inner).trim();
    if (!rest) return " ";
    return open ? `${open}${rest}${close}` : `${/^\s/.test(inner) ? " " : ""}${rest}${/\s$/.test(inner) ? " " : ""}`;
  });
  const body = kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
  return body ? `${head}${body}` : null;
}

// ── Rules ──

interface Rule {
  rule: CardLintRule;
  fields: CardLintField[];
  title: string;
  why: string;
  fix: LineFix;
  skip?: (value: string) => boolean;
}

const RULES: Rule[] = [
  {
    rule: "mojibake",
    fields: ["name", ...MODEL_FIELDS, "creator_notes"],
    title: "Garbled characters",
    why: "The card was saved with the wrong text encoding, so quotes and accents show up as junk like â€™. The model copies the junk.",
    fix: (line) => repairMojibake(line),
  },
  {
    rule: "speaker_prefix",
    fields: GREETINGS,
    title: "Speaker label in the greeting",
    why: "A greeting that opens with a name label like {{char}}: teaches the model to put its own name label in front of every reply.",
    // Every bubble's label goes when all labels are the character's; with other speakers present, only the opener.
    fix: (line, name, first, text) =>
      first || onlyOwnLabels(text, name) ? line.replace(speakerPrefix(name), "$1") : line,
    // A greeting that scripts both sides is a different format; stripping one side would scramble it.
    skip: (value) => USER_TURN.test(value),
  },
  {
    rule: "legacy_scaffolding",
    fields: MODEL_FIELDS,
    title: "Old Claude 2 scaffolding",
    why: "Human:/Assistant: turn markers and bracketed jailbreak notes were written for 2023-era models. Today's models read them as part of the story.",
    fix: fixScaffolding,
  },
  {
    rule: "ai_lines",
    fields: ["mes_example", ...GREETINGS],
    title: "AI-sounding lines",
    why: "Stock phrases like “eyes sparkling with mischief” in examples and greetings get copied into every reply.",
    fix: fixAiLine,
  },
];

function fixText(text: string, rule: Rule, name: string): { text: string; edits: CardLintEdit[] } {
  if (rule.skip?.(text)) return { text, edits: [] };
  const lines: string[] = [];
  const edits: CardLintEdit[] = [];
  let first = true;
  for (const line of text.split("\n")) {
    const next = rule.fix(line, name, first, text);
    if (line.trim()) first = false;
    if (next !== line) edits.push(editOf(line, next ?? ""));
    if (next !== null) lines.push(next);
  }
  return { text: lines.join("\n"), edits };
}

function fieldTexts(data: CardData, field: CardLintField): string[] | null {
  const value = data[field];
  if (field === "alternate_greetings") {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  }
  return typeof value === "string" && value ? [value] : null;
}

function clip(text: string, from: number, to: number): string {
  const start = Math.max(0, from - 40);
  const end = Math.min(text.length, to + 40, start + 240);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`.replace(/\s+/g, " ");
}

/** A short before/after pair centred on where the two lines differ. */
function editOf(before: string, after: string): CardLintEdit {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return {
    before: clip(before, head, before.length - tail),
    after: after ? clip(after, head, after.length - tail) : "",
  };
}

function cardName(data: CardData): string {
  return typeof data.name === "string" ? data.name : "";
}

/** Everything worth fixing in a card, one finding per rule and field. */
export function lintCharacterCard(data: CardData): CardLintFinding[] {
  const name = cardName(data);
  const findings: CardLintFinding[] = [];
  for (const rule of RULES) {
    for (const field of rule.fields) {
      const texts = fieldTexts(data, field);
      if (!texts) continue;
      const edits = texts.flatMap((text) => fixText(text, rule, name).edits);
      if (edits.length === 0) continue;
      findings.push({ id: `${rule.rule}:${field}`, rule: rule.rule, field, title: rule.title, why: rule.why, edits });
    }
  }
  return findings;
}

/** The data patch that applies one finding's fix to the card as it is now. */
export function fixCardLintFinding(data: CardData, finding: Pick<CardLintFinding, "rule" | "field">): CardData {
  const rule = RULES.find((item) => item.rule === finding.rule);
  const texts = fieldTexts(data, finding.field);
  if (!rule || !texts) return {};
  const name = cardName(data);
  const fixed = texts.map((text) => fixText(text, rule, name).text);
  if (finding.field === "alternate_greetings") {
    // Drop only greetings this fix emptied; anything that was already blank is not ours to touch.
    return { alternate_greetings: fixed.filter((text, index) => text.trim() || !texts[index]!.trim()) };
  }
  return { [finding.field]: fixed[0] };
}
