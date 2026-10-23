// ──────────────────────────────────────────────
// Fanfic quality check: score a whole fic so runs can be compared
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import type {
  FanficContinuityCategory,
  FanficContinuityIssue,
  FanficQualityCriterionId,
  FanficQualityGroupId,
  FanficQualityMechanics,
  FanficQualityRun,
  FanficQualityStore,
  FanficRequest,
} from "../../contracts/types/fanfic";
import { FANFIC_CONTINUITY_CATEGORIES } from "../../contracts/types/fanfic";
import { parseJsonObject } from "../../core/json";
import {
  assertLocalOnlyConnection,
  isModelRouteError,
  readModelRoutingSettings,
  resolveModelRoute,
  type ModelRoutingSettings,
} from "../../generation/model-routing";
import { noteHelperRun, resolveHelperRoute, type HelperRunRule } from "../../generation/helper-runs";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { detectFanficAiIsms } from "./ai-isms";
import {
  cleanFanficReply,
  completeFanficJson,
  FanficReplyParseError,
  loadFanficConnection,
  parseFanficJsonReply,
} from "./llm-json";
import { fanficChapterRefs } from "./chapters";
import { renderFanficRequestForPrompt } from "./prompts";
import { detectFanficRepetition, fanficRepetitionNames } from "./repetition";
import { FANFIC_RATING_LABELS, readFanficState } from "./request";
import { userFacingError } from "../../shared/user-facing-error";

/**
 * Bumped whenever a judge prompt or the scoring changes, so runs judged differently are never compared as equals.
 */
export const FANFIC_QUALITY_JUDGE_VERSION = 1;
/** Runs kept per fic; the oldest drop off. */
export const FANFIC_QUALITY_MAX_RUNS = 30;
/** Above this the whole fic no longer fits one judge pass on most models. */
export const FANFIC_QUALITY_MAX_CHARS = 600_000;

interface CriterionSpec {
  id: FanficQualityCriterionId;
  /** Name the judge writes back, so the reply can be parsed. */
  name: string;
  group: FanficQualityGroupId;
  /** Lower is better; inverted before it counts toward a score. */
  negative: boolean;
  /** What the judge looks for. */
  looksFor: string;
}

/**
 * The criteria follow EQ-Bench Longform's final-piece rubric (0-20 per criterion, faults inverted), grouped into the
 * benchmark's four headline areas.
 */
export const FANFIC_QUALITY_CRITERIA: readonly CriterionSpec[] = [
  {
    id: "compelling_plot",
    name: "Compelling Plot",
    group: "creativity",
    negative: false,
    looksFor: "stakes that build, turns the reader doesn't see coming, more than one thread pulling",
  },
  {
    id: "world_building",
    name: "World Building",
    group: "creativity",
    negative: false,
    looksFor: "places, rules and texture that feel specific to this fandom and story",
  },
  {
    id: "earned_tone",
    name: "Well-earned Lightness or Darkness",
    group: "creativity",
    negative: false,
    looksFor: "comfort, humor, or darkness the story has paid for rather than handed out",
  },
  {
    id: "uncreative",
    name: "Unsurprising or Uncreative",
    group: "creativity",
    negative: true,
    looksFor: "the most obvious version of every beat, stock scenarios, safe choices",
  },
  {
    id: "coherent",
    name: "Coherent",
    group: "coherence",
    negative: false,
    looksFor: "events, facts and timeline that hold together across chapters",
  },
  {
    id: "pacing",
    name: "Pacing",
    group: "coherence",
    negative: false,
    looksFor: "time spent where it matters; no sagging middle, no rushed ending",
  },
  {
    id: "faithful",
    name: "Faithful to Writing Prompt",
    group: "coherence",
    negative: false,
    looksFor: "delivers what the request asked for: premise, pairing, tags, point of view, rating",
  },
  {
    id: "unearned_transformations",
    name: "Unearned Transformations",
    group: "coherence",
    negative: true,
    looksFor: "characters or relationships changing without the story doing the work",
  },
  {
    id: "believable_actions",
    name: "Believable Character Actions",
    group: "character",
    negative: false,
    looksFor: "choices that follow from who the characters are, including canon personality",
  },
  {
    id: "nuanced_characters",
    name: "Nuanced Characters",
    group: "character",
    negative: false,
    looksFor: "contradictions, flaws, wants that pull against each other, morally mixed choices",
  },
  {
    id: "emotionally_engaging",
    name: "Emotionally Engaging",
    group: "character",
    negative: false,
    looksFor: "the reader feels it, rather than being told what to feel",
  },
  {
    id: "weak_dialogue",
    name: "Weak Dialogue",
    group: "character",
    negative: true,
    looksFor: "everyone sounding alike, speeches that explain, lines no person would say",
  },
  {
    id: "tell_dont_show",
    name: "Tell-Don't-Show",
    group: "prose",
    negative: true,
    looksFor: "naming emotions and themes outright, explaining what a scene already showed",
  },
  {
    id: "purple_prose",
    name: "Purple Prose",
    group: "prose",
    negative: true,
    looksFor: "ornate, overwritten sentences that call attention to themselves",
  },
  {
    id: "forced_poetry",
    name: "Forced Poetry or Metaphor",
    group: "prose",
    negative: true,
    looksFor: "metaphors and lyrical lines that don't fit the moment or the narrator",
  },
  {
    id: "amateurish",
    name: "Amateurish",
    group: "prose",
    negative: true,
    looksFor: "clichés, stock phrases, clumsy rhythm, the habits of machine-written fiction",
  },
];

export const FANFIC_QUALITY_GROUP_LABELS: Record<FanficQualityGroupId, string> = {
  creativity: "Creativity",
  coherence: "Coherence",
  character: "Character",
  prose: "Prose",
};

export const FANFIC_CONTINUITY_CATEGORY_LABELS: Record<FanficContinuityCategory, string> = {
  timeline: "Timeline & plot logic",
  character: "Characterization",
  world: "World & setting",
  detail: "Facts & details",
  narrative: "Narrative & style",
};

export const FANFIC_CONTINUITY_SUBTYPES: Record<FanficContinuityCategory, string> = {
  timeline:
    "absolute time, durations, things happening at once that can't, effects without causes, broken cause and effect, plot threads dropped without a word",
  character:
    "someone remembering what didn't happen or forgetting what did, knowing what they were never told, skills or abilities that come and go",
  world: "the setting's own rules, its social norms, geography and distances",
  detail:
    "appearance (eyes, hair, scars, clothes), names and titles, numbers and quantities, injuries that vanish or move, objects that are lost and then in hand",
  narrative: "point of view or tense slipping, tone or style swerving for no reason",
};

export type FanficQualityPhase = "counting" | "judging" | "verifying_continuity";

export class FanficQualityParseError extends FanficReplyParseError {
  readonly raw: string;

  constructor(part: string, raw: string) {
    super(`The judge's ${part} reply could not be read. Try again, or pick a different connection.`);
    this.name = "FanficQualityParseError";
    this.raw = raw;
  }
}

// ── Counting ───────────────────────────────────

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The detector counts: AI-sounding habits and repeats, normalized per 1,000 words so fics of any length compare. */
export function scoreFanficMechanics(chapters: string[], names: string[]): FanficQualityMechanics {
  const words = chapters.reduce((sum, chapter) => sum + wordCount(chapter), 0);
  const tells = new Map<string, number>();
  let tellHits = 0;
  for (const chapter of chapters) {
    for (const finding of detectFanficAiIsms(chapter).findings) {
      tellHits += finding.count;
      tells.set(finding.label, (tells.get(finding.label) ?? 0) + finding.count);
    }
  }
  const repetition = detectFanficRepetition(chapters, { names });
  const repeatUses = repetition.repeats.reduce((sum, repeat) => sum + repeat.count, 0);
  const perThousand = (count: number) => (words > 0 ? round1((count / words) * 1000) : 0);
  return {
    words,
    aiTellHits: tellHits,
    aiTellsPer1k: perThousand(tellHits),
    topTells: [...tells.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count })),
    repeatUses,
    repeatUsesPer1k: perThousand(repeatUses),
    repeats: repetition.repeats
      .slice(0, 8)
      .map((repeat) => ({ kind: repeat.kind, term: repeat.term, count: repeat.count })),
  };
}

// ── Prompts ────────────────────────────────────

function renderStory(chapters: string[]): string {
  return chapters.map((text, index) => `### Chapter ${index + 1}\n\n${text.trim()}`).join("\n\n");
}

/**
 * The fic's request, minus the requester's style sample, so the judge scores the story against what was asked. The
 * length is what was written: a one-shot the requester kept going isn't unfaithful to its prompt.
 */
function requestBlock(request: FanficRequest, chapterCount: number): string {
  return renderFanficRequestForPrompt({
    ...request,
    styleNotes: "",
    chapterCount: Math.max(request.chapterCount, chapterCount),
  });
}

export function fanficQualityRatingNote(request: FanficRequest): string {
  return `The requester asked for a ${FANFIC_RATING_LABELS[request.rating]} fic for their own reading. Judge the craft; content within that rating is not a fault.`;
}

export function buildFanficRubricMessages(args: { request: FanficRequest; chapters: string[] }): LlmMessage[] {
  const negatives = FANFIC_QUALITY_CRITERIA.filter((criterion) => criterion.negative);
  const system = [
    "You are a demanding fiction editor scoring a finished piece of fan fiction. Be critical: a 20 is a masterpiece a professional editor would publish untouched, 10 is competent but forgettable, and most model-written fiction lands well below the top of the scale.",
    fanficQualityRatingNote(args.request),
    "Pay particular attention to consistency across chapters, whether stakes actually build, whether characters stay themselves, and whether the prose sounds like a person wrote it.",
    "## Criteria (each scored 0-20)",
    FANFIC_QUALITY_CRITERIA.map((criterion) => `- ${criterion.name}: ${criterion.looksFor}`).join("\n"),
    `For these faults a higher score means MORE of the fault (lower is better): ${negatives.map((criterion) => criterion.name).join(", ")}.`,
    "## Reply format",
    "Write `## Analysis`, then 150-300 words naming the biggest strengths and failings with short examples. Then write `## Scores` and one line per criterion, exactly `Criterion Name: N` with N a whole number from 0 to 20, using the names above. No other text after the scores.",
    `## The request\n${requestBlock(args.request, args.chapters.length)}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `## The fic\n\n${renderStory(args.chapters)}\n\nScore it now.` },
  ];
}

/**
 * Two focused sweeps find more than one broad one (ConStory-Checker extracts per category too), and they run in
 * parallel.
 */
export const FANFIC_CONTINUITY_SWEEPS: readonly (readonly FanficContinuityCategory[])[] = [
  ["timeline", "character"],
  ["detail", "world", "narrative"],
];

export function buildFanficContinuityMessages(args: {
  request: FanficRequest;
  chapters: string[];
  categories?: readonly FanficContinuityCategory[];
}): LlmMessage[] {
  const focus = args.categories?.length ? args.categories : FANFIC_CONTINUITY_CATEGORIES;
  const categories = focus
    .map(
      (category) =>
        `- ${category} (${FANFIC_CONTINUITY_CATEGORY_LABELS[category]}): ${FANFIC_CONTINUITY_SUBTYPES[category]}`,
    )
    .join("\n");
  const system = [
    "You are a continuity editor. Find places where this fic contradicts itself: two passages that cannot both be true in the story as written. Read every chapter closely and track the facts as you go; the middle chapters are where slips usually hide.",
    fanficQualityRatingNote(args.request),
    focus.length < FANFIC_CONTINUITY_CATEGORIES.length
      ? "## What counts (this pass looks only for these; another pass covers the rest)"
      : "## What counts",
    categories,
    "## What does not count",
    "- Things the story explains (a wound that heals over weeks, a character who lies, a dream, a deliberate twist).",
    "- Gaps, vagueness, or things that merely seem unlikely; only real contradictions.",
    "- Deviations from canon the request asked for (alternate universe, canon divergence).",
    "- Style complaints, repetition, or quality judgments.",
    "## Reply format",
    'Reply with JSON only: {"issues": [{"category": string, "subtype": string, "earlierChapter": number, "earlierQuote": string, "laterChapter": number, "laterQuote": string, "explanation": string}]}',
    "- category is one of: " + focus.join(", ") + ". subtype is a few words, e.g. `injury vanishes`.",
    "- Each quote is copied character for character from the fic, 5 to 30 words, enough to find the passage. Never paraphrase.",
    "- Both quotes may come from the same chapter. explanation is one sentence saying why both can't be true.",
    '- List at most 12 issues, most serious first. If there are none, reply {"issues": []}.',
    `## The request\n${requestBlock(args.request, args.chapters.length)}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `## The fic\n\n${renderStory(args.chapters)}\n\nList the contradictions now.` },
  ];
}

export function buildFanficContinuityVerifyMessages(args: {
  request: FanficRequest;
  chapters: string[];
  issues: FanficContinuityIssue[];
}): LlmMessage[] {
  const candidates = args.issues
    .map(
      (issue, index) =>
        `${index + 1}. Chapter ${issue.earlierChapter}: "${issue.earlierQuote}" vs chapter ${issue.laterChapter}: "${issue.laterQuote}". Claimed: ${issue.explanation}`,
    )
    .join("\n");
  const system = [
    "You double-check a continuity editor's notes on a fic. For each numbered note, reread the fic around both passages and decide whether they truly contradict each other.",
    "A note is a real contradiction only when both passages cannot be true in the story as written. It is not one when the fic explains it elsewhere, when time passes enough to account for it, when a character lies or misremembers on purpose, or when the note misreads the passage.",
    'Reply with JSON only: {"verdicts": [{"note": number, "reason": string, "contradiction": boolean, "sameAs": number | null}]}, exactly one entry per note. Write reason first: one sentence on what the fic actually says around both passages. Then decide.',
    "Two notes can describe the same contradiction while quoting different lines. When a note repeats an earlier note's contradiction, set sameAs to that earlier note's number; otherwise sameAs is null.",
    `## The notes\n${candidates}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `## The fic\n\n${renderStory(args.chapters)}\n\nCheck every note now.` },
  ];
}

// ── Parsing ────────────────────────────────────

function criterionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export interface FanficRubricResult {
  criteria: Record<FanficQualityCriterionId, number>;
  analysis: string;
}

/** Reads `Criterion: N` lines; every criterion must be present, or the run would compare unlike things. */
export function parseFanficRubricReply(raw: string): FanficRubricResult {
  const text = cleanFanficReply(raw).replace(/\*\*/g, "");
  const byKey = new Map(FANFIC_QUALITY_CRITERIA.map((criterion) => [criterionKey(criterion.name), criterion.id]));
  const scoresStart = text.search(/^#*\s*Scores\b/im);
  const scoreText = scoresStart >= 0 ? text.slice(scoresStart) : text;
  const criteria: Partial<Record<FanficQualityCriterionId, number>> = {};
  for (const match of scoreText.matchAll(/^[\s\-*]*([A-Za-z][A-Za-z' -]+?)\s*:\s*\[?(\d{1,2}(?:\.\d+)?)\]?/gm)) {
    const id = byKey.get(criterionKey(match[1]));
    const score = Number(match[2]);
    if (id && Number.isFinite(score) && score >= 0 && score <= 20) criteria[id] = score;
  }
  const missing = FANFIC_QUALITY_CRITERIA.filter((criterion) => criteria[criterion.id] === undefined);
  if (missing.length > 0) throw new FanficQualityParseError("rubric", raw);
  const analysisMatch = text.match(/^#*\s*Analysis\b[^\n]*\n([\s\S]*?)(?=^#*\s*Scores\b)/im);
  const analysis = (analysisMatch?.[1] ?? (scoresStart > 0 ? text.slice(0, scoresStart) : "")).trim().slice(0, 4000);
  return { criteria: criteria as Record<FanficQualityCriterionId, number>, analysis };
}

/** Mean of the criteria on a 0-10 scale, with faults inverted (EQ-Bench style: 20 - score). Unrounded. */
function meanScore(criteria: Record<FanficQualityCriterionId, number>, members: readonly CriterionSpec[]): number {
  const total = members.reduce(
    (sum, criterion) => sum + (criterion.negative ? 20 - criteria[criterion.id] : criteria[criterion.id]),
    0,
  );
  return total / members.length / 2;
}

/** 0-10 per group and overall. */
export function summarizeFanficRubric(criteria: Record<FanficQualityCriterionId, number>) {
  const groups = {} as Record<FanficQualityGroupId, number>;
  for (const group of Object.keys(FANFIC_QUALITY_GROUP_LABELS) as FanficQualityGroupId[]) {
    groups[group] = round1(
      meanScore(
        criteria,
        FANFIC_QUALITY_CRITERIA.filter((criterion) => criterion.group === group),
      ),
    );
  }
  return { groups, overall: round1(meanScore(criteria, FANFIC_QUALITY_CRITERIA)) };
}

function readCategory(value: unknown): FanficContinuityCategory {
  const text = readString(value).toLowerCase();
  return (FANFIC_CONTINUITY_CATEGORIES as readonly string[]).includes(text)
    ? (text as FanficContinuityCategory)
    : "detail";
}

function readChapter(value: unknown): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** A quote without the quotation marks the judge may wrap it in, so it shows as one quote. */
function readQuote(value: unknown): string {
  return readString(value)
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim()
    .slice(0, 400);
}

/**
 * The continuity editor's candidates, before their quotes are checked against the text. Every entry needs both quotes
 * and an explanation; a reply with a broken entry is a bad reply (retried), never a clean result.
 */
export function parseFanficContinuityReply(raw: string): FanficContinuityIssue[] {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.issues)) throw new FanficQualityParseError("continuity", raw);
  return parsed.issues.map((issue) => readFanficContinuityIssue(issue, raw));
}

/** One candidate from a continuity reply; a broken entry makes the whole reply a bad reply. */
export function readFanficContinuityIssue(issue: unknown, raw: string): FanficContinuityIssue {
  if (!isRecord(issue)) throw new FanficQualityParseError("continuity", raw);
  const entry: FanficContinuityIssue = {
    category: readCategory(issue.category),
    subtype: readString(issue.subtype).trim().slice(0, 80),
    earlierChapter: readChapter(issue.earlierChapter),
    earlierQuote: readQuote(issue.earlierQuote),
    laterChapter: readChapter(issue.laterChapter),
    laterQuote: readQuote(issue.laterQuote),
    explanation: readString(issue.explanation).trim().slice(0, 400),
  };
  if (!entry.earlierQuote || !entry.laterQuote || !entry.explanation) {
    throw new FanficQualityParseError("continuity", raw);
  }
  return entry;
}

export interface FanficContinuityVerdicts {
  /** Notes the second read confirmed. */
  confirmed: Set<number>;
  /** Note number -> the earlier note it repeats. */
  sameAs: Map<number, number>;
}

/**
 * The second read's verdicts. It must rule on every note: an omitted note was never checked, so a partial reply is a
 * bad reply (retried) rather than a quiet rejection.
 */
export function parseFanficContinuityVerdicts(raw: string, noteCount: number): FanficContinuityVerdicts {
  const parsed = parseFanficJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.verdicts)) throw new FanficQualityParseError("continuity check", raw);
  const confirmed = new Set<number>();
  const sameAs = new Map<number, number>();
  const ruled = new Set<number>();
  for (const verdict of parsed.verdicts) {
    if (!isRecord(verdict) || typeof verdict.contradiction !== "boolean") {
      throw new FanficQualityParseError("continuity check", raw);
    }
    const note = Number(verdict.note);
    if (!Number.isInteger(note) || note < 1 || note > noteCount || ruled.has(note)) {
      throw new FanficQualityParseError("continuity check", raw);
    }
    ruled.add(note);
    if (verdict.contradiction) confirmed.add(note);
    const earlier = Number(verdict.sameAs);
    if (Number.isInteger(earlier) && earlier >= 1 && earlier < note) sameAs.set(note, earlier);
  }
  if (ruled.size !== noteCount) throw new FanficQualityParseError("continuity check", raw);
  return { confirmed, sameAs };
}

/**
 * Confirmed notes, minus repeats: a note counts once even when quoted two ways, and a repeat only folds into an
 * earlier note the second read also confirmed (otherwise the repeat stands on its own).
 */
export function confirmedFanficContinuityIssues<T extends FanficContinuityIssue>(
  issues: T[],
  verdicts: FanficContinuityVerdicts,
): { confirmed: T[]; merged: number } {
  const confirmed: T[] = [];
  let merged = 0;
  issues.forEach((issue, index) => {
    const note = index + 1;
    if (!verdicts.confirmed.has(note)) return;
    const earlier = verdicts.sameAs.get(note);
    if (earlier !== undefined && verdicts.confirmed.has(earlier)) {
      merged += 1;
      return;
    }
    confirmed.push(issue);
  });
  return { confirmed, merged };
}

// ── Grounding ──────────────────────────────────

/** Lowercased words only, so curly quotes, italics markers, and line breaks never hide a real quote. */
/** Whether the quote's words appear in the text as whole words, in order (punctuation, case, and quote marks aside). */
export function fanficTextHolds(text: string, quote: string): boolean {
  const needle = fanficSearchableText(quote);
  return needle.length > 0 && ` ${fanficSearchableText(text)} `.includes(` ${needle} `);
}

export function fanficSearchableText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}']+/gu, " ")
    .trim();
}

function chapterHolding(quote: string, chapters: string[], claimed: number): number {
  const needle = fanficSearchableText(quote);
  if (needle.split(" ").length < 3) return 0;
  if (claimed >= 1 && claimed <= chapters.length && fanficTextHolds(chapters[claimed - 1]!, quote)) return claimed;
  const found = chapters.findIndex((chapter) => fanficTextHolds(chapter, quote));
  return found + 1;
}

const SHARED_RUN = 6;

/** Two quotes of the same passage: one holds the other, or they share a run of six words. */
export function fanficSamePassage(left: string, right: string): boolean {
  const a = fanficSearchableText(left);
  const b = fanficSearchableText(right);
  if (a.includes(b) || b.includes(a)) return true;
  const words = a.split(" ");
  for (let start = 0; start + SHARED_RUN <= words.length; start += 1) {
    if (b.includes(words.slice(start, start + SHARED_RUN).join(" "))) return true;
  }
  return false;
}

/**
 * Keeps only issues whose quotes are really in the fic, fixing a misnumbered chapter when the quote is found
 * elsewhere. Models paraphrase "quotes"; an issue nobody can find in the text isn't evidence. Only an exact repeat
 * (same category, both passages the same) is dropped here; the second read folds repeats quoted with different lines.
 */
export function groundFanficContinuityIssues(
  issues: FanficContinuityIssue[],
  chapters: string[],
): { grounded: FanficContinuityIssue[]; dropped: number; repeats: number } {
  const grounded: FanficContinuityIssue[] = [];
  let dropped = 0;
  let repeats = 0;
  for (const issue of issues) {
    const earlierChapter = chapterHolding(issue.earlierQuote, chapters, issue.earlierChapter);
    const laterChapter = chapterHolding(issue.laterQuote, chapters, issue.laterChapter);
    if (
      !earlierChapter ||
      !laterChapter ||
      fanficSearchableText(issue.earlierQuote) === fanficSearchableText(issue.laterQuote)
    ) {
      dropped += 1;
      continue;
    }
    const ordered =
      earlierChapter <= laterChapter
        ? { earlierChapter, laterChapter, earlierQuote: issue.earlierQuote, laterQuote: issue.laterQuote }
        : {
            earlierChapter: laterChapter,
            laterChapter: earlierChapter,
            earlierQuote: issue.laterQuote,
            laterQuote: issue.earlierQuote,
          };
    const duplicate = grounded.some(
      (kept) =>
        kept.category === issue.category &&
        kept.earlierChapter === ordered.earlierChapter &&
        kept.laterChapter === ordered.laterChapter &&
        fanficSamePassage(kept.earlierQuote, ordered.earlierQuote) &&
        fanficSamePassage(kept.laterQuote, ordered.laterQuote),
    );
    if (duplicate) {
      repeats += 1;
      continue;
    }
    grounded.push({ ...issue, ...ordered });
  }
  return { grounded, dropped, repeats };
}

/**
 * Several judge passes averaged per criterion, so one generous or harsh read doesn't swing the score. `spread` is how
 * far apart the passes' overall scores were, a rough noise bar for comparing runs.
 */
export function averageFanficRubrics(
  results: FanficRubricResult[],
): FanficRubricResult & { passes: number; spread: number } {
  if (results.length === 0) throw new Error("No rubric passes to average.");
  const criteria = {} as Record<FanficQualityCriterionId, number>;
  for (const criterion of FANFIC_QUALITY_CRITERIA) {
    criteria[criterion.id] = round1(
      results.reduce((sum, result) => sum + result.criteria[criterion.id], 0) / results.length,
    );
  }
  const overalls = results.map((result) => meanScore(result.criteria, FANFIC_QUALITY_CRITERIA));
  return {
    criteria,
    analysis: results.find((result) => result.analysis)?.analysis ?? "",
    passes: results.length,
    spread: round1(Math.max(...overalls) - Math.min(...overalls)),
  };
}

// ── Storage ────────────────────────────────────

const REPEAT_KINDS: readonly unknown[] = ["pet_name", "detail", "phrase"];
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === "string";

function isContinuityIssue(value: unknown): value is FanficContinuityIssue {
  return (
    isRecord(value) &&
    (FANFIC_CONTINUITY_CATEGORIES as readonly unknown[]).includes(value.category) &&
    [value.subtype, value.earlierQuote, value.laterQuote, value.explanation].every(isString) &&
    isNumber(value.earlierChapter) &&
    isNumber(value.laterChapter)
  );
}

/** A stored run with every field the panel reads; anything else (hand-edited, from another version) is skipped. */
function isQualityRun(value: unknown): value is FanficQualityRun {
  if (!isRecord(value)) return false;
  const { judge, mechanics, rubric, continuity } = value;
  return (
    [value.id, value.createdAt, value.label, value.textKey].every(isString) &&
    isNumber(value.judgeVersion) &&
    isNumber(value.chapterCount) &&
    isRecord(judge) &&
    [judge.connectionId, judge.connectionName, judge.model].every(isString) &&
    isRecord(mechanics) &&
    [
      mechanics.words,
      mechanics.aiTellHits,
      mechanics.aiTellsPer1k,
      mechanics.repeatUses,
      mechanics.repeatUsesPer1k,
    ].every(isNumber) &&
    Array.isArray(mechanics.topTells) &&
    mechanics.topTells.every((tell) => isRecord(tell) && isString(tell.label) && isNumber(tell.count)) &&
    Array.isArray(mechanics.repeats) &&
    mechanics.repeats.every(
      (repeat) =>
        isRecord(repeat) && REPEAT_KINDS.includes(repeat.kind) && isString(repeat.term) && isNumber(repeat.count),
    ) &&
    isRecord(rubric) &&
    isRecord(rubric.criteria) &&
    FANFIC_QUALITY_CRITERIA.every((criterion) => isNumber((rubric.criteria as JsonRecord)[criterion.id])) &&
    isRecord(rubric.groups) &&
    (Object.keys(FANFIC_QUALITY_GROUP_LABELS) as FanficQualityGroupId[]).every((group) =>
      isNumber((rubric.groups as JsonRecord)[group]),
    ) &&
    [rubric.overall, rubric.passes, rubric.spread].every(isNumber) &&
    isString(rubric.analysis) &&
    isRecord(continuity) &&
    Array.isArray(continuity.issues) &&
    continuity.issues.every(isContinuityIssue) &&
    [continuity.candidates, continuity.ungrounded, continuity.rejected, continuity.merged, continuity.per10k].every(
      isNumber,
    )
  );
}

function rawStore(metadata: unknown): unknown {
  return parseJsonObject(metadata).fanficQuality ?? null;
}

function readRuns(metadata: unknown): FanficQualityRun[] {
  const raw = rawStore(metadata);
  if (!isRecord(raw) || !Array.isArray(raw.runs)) return [];
  return raw.runs.filter(isQualityRun);
}

const STORE_WRITE_ATTEMPTS = 5;

/**
 * Rewrites the saved runs as a compare-and-set on `metadata.fanficQuality`, retrying against the latest value, so a
 * run saved or deleted from another tab at the same moment is never overwritten.
 */
async function updateRuns(
  storage: StorageGateway,
  chatId: string,
  change: (runs: FanficQualityRun[]) => FanficQualityRun[],
): Promise<void> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged)
    throw userFacingError(
      "This De-Koi server is too old to save quality checks safely. Update and restart it, then try again.",
    );
  for (let attempt = 0; attempt < STORE_WRITE_ATTEMPTS; attempt += 1) {
    const chat = await storage.get("chats", chatId);
    if (!isRecord(chat)) throw new Error("Chat was not found.");
    const { updated } = await updateChatIfUnchanged.call(
      storage,
      chatId,
      { metadata: { fanficQuality: rawStore(chat.metadata) } },
      { metadata: { fanficQuality: { runs: change(readRuns(chat.metadata)) } } },
    );
    if (updated) return;
  }
  throw userFacingError("The quality runs kept changing while saving. Try again.");
}

/** Saved runs, oldest first. */
export function readFanficQualityStore(metadata: unknown): FanficQualityStore {
  return { runs: readRuns(metadata) };
}

/** Same chapters, same text: a short fingerprint so the history can say when the fic changed between runs. */
export function fanficTextKey(chapters: string[]): string {
  let hash = 0x811c9dc5;
  const text = chapters.join("\u0000");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${chapters.length}-${(hash >>> 0).toString(36)}`;
}

function newRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Drops one saved run. */
export async function deleteFanficQualityRun(storage: StorageGateway, chatId: string, runId: string): Promise<void> {
  await updateRuns(storage, chatId, (runs) => runs.filter((run) => run.id !== runId));
}

// ── Running ────────────────────────────────────

/** Rubric reads averaged per run (EQ-Bench Longform also averages several final judgments). */
export const FANFIC_QUALITY_RUBRIC_PASSES = 2;
const RUBRIC_MAX_TOKENS = 4000;
const CONTINUITY_MAX_TOKENS = 6000;
const VERIFY_MAX_TOKENS = 4000;

/**
 * The judge the quality panel starts on: the fic's last judge (so scores stay comparable), then the fanfic judge
 * helper route, then the fic's connection, then the first text connection. A broken route, or a local-only judge
 * whose pick is not local, picks nothing and says why, instead of quietly starting on another connection.
 */
export function chooseFanficJudge(input: {
  lastJudgeId: string | null;
  ficConnectionId: string | null;
  judgeIds: readonly string[];
  routing: ModelRoutingSettings;
  connections: readonly JsonRecord[];
}): { judgeId: string | null; routeProblem: string | null; rule: FanficJudgeRule | null } {
  const listed = (id: string | null): id is string => !!id && input.judgeIds.includes(id);
  try {
    if (listed(input.lastJudgeId)) {
      const lastJudge = input.connections.find((connection) => readString(connection.id).trim() === input.lastJudgeId);
      assertLocalOnlyConnection("judge", input.routing, input.lastJudgeId, lastJudge);
      return { judgeId: input.lastJudgeId, routeProblem: null, rule: "lastJudge" };
    }
    const routed = resolveModelRoute("judge", input.routing, input.connections);
    if (routed) return { judgeId: readString(routed.id).trim(), routeProblem: null, rule: "route" };
  } catch (error) {
    if (isModelRouteError(error)) return { judgeId: null, routeProblem: error.message, rule: null };
    throw error;
  }
  if (listed(input.ficConnectionId)) return { judgeId: input.ficConnectionId, routeProblem: null, rule: "chat" };
  const first = input.judgeIds[0] ?? null;
  return { judgeId: first, routeProblem: null, rule: first ? "first" : null };
}

/** Why the quality panel's judge is the one it is; "picked" once the requester changes it. */
export type FanficJudgeRule = Extract<HelperRunRule, "lastJudge" | "route" | "chat" | "first" | "picked">;

export interface RunFanficQualityInput {
  chatId: string;
  /** The judge; defaults to the fanfic judge helper route, then the fic's own connection. */
  connectionId?: string | null;
  /** Why `connectionId` is the judge (see chooseFanficJudge); a judge passed without one counts as picked by hand. */
  rule?: FanficJudgeRule | null;
  label?: string;
}

/**
 * Scores the fic as it reads now (each chapter's chosen version): detector counts, a critic's rubric, and a
 * continuity sweep whose findings are checked twice (quotes must exist, then a second read must confirm). The run is
 * appended to `metadata.fanficQuality` and returned.
 */
export async function runFanficQualityCheck(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: RunFanficQualityInput,
  options: { signal?: AbortSignal; onPhase?: (phase: FanficQualityPhase) => void; now?: () => Date } = {},
): Promise<FanficQualityRun> {
  const { signal, onPhase } = options;
  const chat = await deps.storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Quality checks only run for fanfic chats.");
  const state = readFanficState(parseRecord(chat.metadata));
  if (!state) throw userFacingError("Fill in the fanfic request first.");
  const picked = readString(input.connectionId).trim();
  const note = { task: "judge" as const, chatId: input.chatId };
  const routedJudge = picked ? null : await resolveHelperRoute(deps.storage, "judge", note);
  const connectionId = picked || readString(routedJudge?.id).trim() || readString(chat.connectionId).trim();
  const rule: FanficJudgeRule = picked ? (input.rule ?? "picked") : routedJudge ? "route" : "chat";
  if (!connectionId || connectionId === "random") throw userFacingError("Pick a connection to judge with.");
  const connection = await loadFanficConnection(deps.storage, connectionId);
  if (!isRecord(connection))
    throw userFacingError("That judge connection no longer exists. Pick another one to judge with.");
  try {
    // A judge picked by hand outranks the route, but a local-only judge still stays local.
    assertLocalOnlyConnection("judge", await readModelRoutingSettings(deps.storage), connectionId, connection);
  } catch (error) {
    if (isModelRouteError(error)) {
      await noteHelperRun(deps.storage, { ...note, rule, connectionId, connection, problem: error.message });
    }
    throw error;
  }
  await noteHelperRun(deps.storage, { ...note, rule, connectionId, connection });

  const messages = await deps.storage.listChatMessages<JsonRecord>(input.chatId);
  const chapters = fanficChapterRefs(messages.filter(isRecord)).map((chapter) => chapter.content);
  if (chapters.length === 0 || chapters.every((chapter) => !chapter.trim())) {
    throw userFacingError("Write a chapter before checking quality.");
  }
  if (chapters.reduce((sum, chapter) => sum + chapter.length, 0) > FANFIC_QUALITY_MAX_CHARS) {
    throw userFacingError("This fic is too long to judge in one pass.");
  }

  onPhase?.("counting");
  const mechanics = scoreFanficMechanics(chapters, fanficRepetitionNames(state.request));

  onPhase?.("judging");
  const rubricMessages = buildFanficRubricMessages({ request: state.request, chapters });
  const rubricPromise = Promise.all(
    Array.from({ length: FANFIC_QUALITY_RUBRIC_PASSES }, () =>
      completeFanficJson(
        deps.llm,
        { connectionId, messages: rubricMessages, maxTokens: RUBRIC_MAX_TOKENS },
        parseFanficRubricReply,
        signal,
      ),
    ),
  ).then(averageFanficRubrics);
  // The continuity sweeps and their double-check run alongside the rubric.
  const continuityPromise = (async () => {
    const sweeps = await Promise.all(
      FANFIC_CONTINUITY_SWEEPS.map((categories) =>
        completeFanficJson(
          deps.llm,
          {
            connectionId,
            messages: buildFanficContinuityMessages({ request: state.request, chapters, categories }),
            maxTokens: CONTINUITY_MAX_TOKENS,
          },
          parseFanficContinuityReply,
          signal,
        ),
      ),
    );
    const candidates = sweeps.flat();
    const { grounded, dropped, repeats } = groundFanficContinuityIssues(candidates, chapters);
    if (grounded.length === 0) {
      return { candidates, grounded, dropped, repeats, confirmed: [] as FanficContinuityIssue[], merged: 0 };
    }
    onPhase?.("verifying_continuity");
    const verdicts = await completeFanficJson(
      deps.llm,
      {
        connectionId,
        messages: buildFanficContinuityVerifyMessages({ request: state.request, chapters, issues: grounded }),
        maxTokens: VERIFY_MAX_TOKENS,
      },
      (raw) => parseFanficContinuityVerdicts(raw, grounded.length),
      signal,
    );
    return { candidates, grounded, dropped, repeats, ...confirmedFanficContinuityIssues(grounded, verdicts) };
  })();
  const [rubric, { candidates, grounded, dropped, repeats, confirmed, merged }] = await Promise.all([
    rubricPromise,
    continuityPromise,
  ]);

  const summary = summarizeFanficRubric(rubric.criteria);
  const run: FanficQualityRun = {
    id: newRunId(),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    label: (input.label ?? "").trim().slice(0, 80),
    judgeVersion: FANFIC_QUALITY_JUDGE_VERSION,
    judge: {
      connectionId,
      connectionName: readString(connection.name).trim(),
      model: readString(connection.model).trim(),
    },
    chapterCount: chapters.length,
    textKey: fanficTextKey(chapters),
    mechanics,
    rubric: {
      criteria: rubric.criteria,
      groups: summary.groups,
      overall: summary.overall,
      analysis: rubric.analysis,
      passes: rubric.passes,
      spread: rubric.spread,
    },
    continuity: {
      issues: confirmed,
      candidates: candidates.length,
      ungrounded: dropped,
      rejected: grounded.length - confirmed.length - merged,
      // Exact repeats dropped before the second read, plus repeats it folded: candidates now add up.
      merged: merged + repeats,
      per10k: mechanics.words > 0 ? Math.round((confirmed.length / mechanics.words) * 100_000) / 10 : 0,
    },
  };

  await updateRuns(deps.storage, input.chatId, (runs) => [...runs, run].slice(-FANFIC_QUALITY_MAX_RUNS));
  return run;
}
