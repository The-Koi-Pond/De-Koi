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
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import { parseJsonObject } from "../../core/json";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { parseGameJsonish } from "../../shared/parsing-jsonish";
import { detectFanficAiIsms } from "./ai-isms";
import { fanficChapterRefs } from "./chapters";
import { renderFanficRequestForPrompt } from "./prompts";
import { detectFanficRepetition, fanficRepetitionNames } from "./repetition";
import { FANFIC_RATING_LABELS, readFanficState } from "./request";

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

const CONTINUITY_SUBTYPES: Record<FanficContinuityCategory, string> = {
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

export class FanficQualityParseError extends Error {
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

function ratingNote(request: FanficRequest): string {
  return `The requester asked for a ${FANFIC_RATING_LABELS[request.rating]} fic for their own reading. Judge the craft; content within that rating is not a fault.`;
}

export function buildFanficRubricMessages(args: { request: FanficRequest; chapters: string[] }): LlmMessage[] {
  const negatives = FANFIC_QUALITY_CRITERIA.filter((criterion) => criterion.negative);
  const system = [
    "You are a demanding fiction editor scoring a finished piece of fan fiction. Be critical: a 20 is a masterpiece a professional editor would publish untouched, 10 is competent but forgettable, and most model-written fiction lands well below the top of the scale.",
    ratingNote(args.request),
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
      (category) => `- ${category} (${FANFIC_CONTINUITY_CATEGORY_LABELS[category]}): ${CONTINUITY_SUBTYPES[category]}`,
    )
    .join("\n");
  const system = [
    "You are a continuity editor. Find places where this fic contradicts itself: two passages that cannot both be true in the story as written. Read every chapter closely and track the facts as you go; the middle chapters are where slips usually hide.",
    ratingNote(args.request),
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
    'Reply with JSON only: {"verdicts": [{"note": number, "reason": string, "contradiction": boolean}]}, one entry per note. Write reason first: one sentence on what the fic actually says around both passages. Then decide.',
    `## The notes\n${candidates}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `## The fic\n\n${renderStory(args.chapters)}\n\nCheck every note now.` },
  ];
}

// ── Parsing ────────────────────────────────────

function cleanReply(raw: string): string {
  return extractLeadingThinkingBlocks(raw).cleanText;
}

function jsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function parseJsonReply(raw: string): JsonRecord | null {
  try {
    const parsed = parseGameJsonish(jsonCandidate(cleanReply(raw)));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function criterionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export interface FanficRubricResult {
  criteria: Record<FanficQualityCriterionId, number>;
  analysis: string;
}

/** Reads `Criterion: N` lines; every criterion must be present, or the run would compare unlike things. */
export function parseFanficRubricReply(raw: string): FanficRubricResult {
  const text = cleanReply(raw).replace(/\*\*/g, "");
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

/** The continuity editor's candidates, before their quotes are checked against the text. */
export function parseFanficContinuityReply(raw: string): FanficContinuityIssue[] {
  const parsed = parseJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.issues)) throw new FanficQualityParseError("continuity", raw);
  return parsed.issues.filter(isRecord).map((issue) => ({
    category: readCategory(issue.category),
    subtype: readString(issue.subtype).trim().slice(0, 80),
    earlierChapter: readChapter(issue.earlierChapter),
    earlierQuote: readQuote(issue.earlierQuote),
    laterChapter: readChapter(issue.laterChapter),
    laterQuote: readQuote(issue.laterQuote),
    explanation: readString(issue.explanation).trim().slice(0, 400),
  }));
}

/** Notes numbers the verifier confirmed as contradictions. */
export function parseFanficContinuityVerdicts(raw: string, noteCount: number): Set<number> {
  const parsed = parseJsonReply(raw);
  if (!parsed || !Array.isArray(parsed.verdicts)) throw new FanficQualityParseError("continuity check", raw);
  const confirmed = new Set<number>();
  for (const verdict of parsed.verdicts.filter(isRecord)) {
    const note = Math.trunc(Number(verdict.note));
    if (note >= 1 && note <= noteCount && verdict.contradiction === true) confirmed.add(note);
  }
  return confirmed;
}

// ── Grounding ──────────────────────────────────

/** Lowercased words only, so curly quotes, italics markers, and line breaks never hide a real quote. */
function searchable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function chapterHolding(quote: string, chapters: string[], claimed: number): number {
  const needle = searchable(quote);
  if (needle.split(" ").length < 3) return 0;
  if (claimed >= 1 && claimed <= chapters.length && searchable(chapters[claimed - 1]).includes(needle)) return claimed;
  const found = chapters.findIndex((chapter) => searchable(chapter).includes(needle));
  return found + 1;
}

const SHARED_RUN = 6;

/** Two quotes of the same passage: one holds the other, or they share a run of six words. */
function samePassage(left: string, right: string): boolean {
  const a = searchable(left);
  const b = searchable(right);
  if (a.includes(b) || b.includes(a)) return true;
  const words = a.split(" ");
  for (let start = 0; start + SHARED_RUN <= words.length; start += 1) {
    if (b.includes(words.slice(start, start + SHARED_RUN).join(" "))) return true;
  }
  return false;
}

/**
 * Keeps only issues whose quotes are really in the fic, fixing a misnumbered chapter when the quote is found
 * elsewhere, and drops a contradiction reported twice (same chapters, a passage in common). Models paraphrase "quotes"; an issue nobody can find
 * in the text isn't evidence.
 */
export function groundFanficContinuityIssues(
  issues: FanficContinuityIssue[],
  chapters: string[],
): { grounded: FanficContinuityIssue[]; dropped: number } {
  const grounded: FanficContinuityIssue[] = [];
  let dropped = 0;
  for (const issue of issues) {
    const earlierChapter = chapterHolding(issue.earlierQuote, chapters, issue.earlierChapter);
    const laterChapter = chapterHolding(issue.laterQuote, chapters, issue.laterChapter);
    if (!earlierChapter || !laterChapter || searchable(issue.earlierQuote) === searchable(issue.laterQuote)) {
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
        kept.earlierChapter === ordered.earlierChapter &&
        kept.laterChapter === ordered.laterChapter &&
        (samePassage(kept.earlierQuote, ordered.earlierQuote) || samePassage(kept.laterQuote, ordered.laterQuote)),
    );
    if (duplicate) continue;
    grounded.push({ ...issue, ...ordered });
  }
  return { grounded, dropped };
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

function readRuns(metadata: unknown): FanficQualityRun[] {
  const raw = parseJsonObject(metadata).fanficQuality;
  if (!isRecord(raw) || !Array.isArray(raw.runs)) return [];
  return raw.runs.filter(
    (run): run is FanficQualityRun =>
      isRecord(run) &&
      typeof run.id === "string" &&
      isRecord(run.mechanics) &&
      isRecord(run.rubric) &&
      isRecord(run.continuity),
  );
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
  const chat = await storage.get("chats", chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  const runs = readRuns(chat.metadata).filter((run) => run.id !== runId);
  await storage.patchChatMetadata(chatId, { fanficQuality: { runs } });
}

// ── Running ────────────────────────────────────

/** Rubric reads averaged per run (EQ-Bench Longform also averages several final judgments). */
export const FANFIC_QUALITY_RUBRIC_PASSES = 2;
const RUBRIC_MAX_TOKENS = 4000;
const CONTINUITY_MAX_TOKENS = 6000;
const VERIFY_MAX_TOKENS = 4000;

export interface RunFanficQualityInput {
  chatId: string;
  /** The judge; defaults to the fic's own connection. */
  connectionId?: string | null;
  label?: string;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Settles as soon as the signal aborts, even when the gateway ignores it (the app gateway's complete() can't cancel a
 * request already sent), so Stop ends the check right away and the late reply is dropped.
 */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function judge<T>(
  llm: LlmGateway,
  request: { connectionId: string; messages: LlmMessage[]; maxTokens: number },
  parse: (raw: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  // One retry: a judge occasionally drifts from the reply format, and the whole run shouldn't fail on that.
  for (let attempt = 0; ; attempt += 1) {
    const raw = await untilAborted(
      llm.complete(
        {
          connectionId: request.connectionId,
          messages: request.messages,
          parameters: { maxTokens: request.maxTokens, temperature: 0 },
        },
        signal,
      ),
      signal,
    );
    try {
      return parse(raw);
    } catch (error) {
      if (attempt >= 1 || !(error instanceof FanficQualityParseError)) throw error;
    }
  }
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
  if (!state) throw new Error("Fill in the fanfic request first.");
  const connectionId = readString(input.connectionId).trim() || readString(chat.connectionId).trim();
  if (!connectionId || connectionId === "random") throw new Error("Pick a connection to judge with.");
  const connection = await deps.storage.get("connections", connectionId);
  if (!isRecord(connection)) throw new Error("The judge connection was not found.");

  const messages = await deps.storage.listChatMessages<JsonRecord>(input.chatId);
  const chapters = fanficChapterRefs(messages.filter(isRecord)).map((chapter) => chapter.content);
  if (chapters.length === 0 || chapters.every((chapter) => !chapter.trim())) {
    throw new Error("Write a chapter before checking quality.");
  }
  if (chapters.reduce((sum, chapter) => sum + chapter.length, 0) > FANFIC_QUALITY_MAX_CHARS) {
    throw new Error("This fic is too long to judge in one pass.");
  }

  onPhase?.("counting");
  const mechanics = scoreFanficMechanics(chapters, fanficRepetitionNames(state.request));

  onPhase?.("judging");
  const rubricMessages = buildFanficRubricMessages({ request: state.request, chapters });
  const rubricPromise = Promise.all(
    Array.from({ length: FANFIC_QUALITY_RUBRIC_PASSES }, () =>
      judge(
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
        judge(
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
    const { grounded, dropped } = groundFanficContinuityIssues(candidates, chapters);
    if (grounded.length === 0) return { candidates, grounded, dropped, confirmed: [] as FanficContinuityIssue[] };
    onPhase?.("verifying_continuity");
    const verdicts = await judge(
      deps.llm,
      {
        connectionId,
        messages: buildFanficContinuityVerifyMessages({ request: state.request, chapters, issues: grounded }),
        maxTokens: VERIFY_MAX_TOKENS,
      },
      (raw) => parseFanficContinuityVerdicts(raw, grounded.length),
      signal,
    );
    return { candidates, grounded, dropped, confirmed: grounded.filter((_, index) => verdicts.has(index + 1)) };
  })();
  const [rubric, { candidates, grounded, dropped, confirmed }] = await Promise.all([rubricPromise, continuityPromise]);

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
      rejected: grounded.length - confirmed.length,
      per10k: mechanics.words > 0 ? Math.round((confirmed.length / mechanics.words) * 100_000) / 10 : 0,
    },
  };

  // Re-read before saving so a run deleted meanwhile, or one saved from another tab, isn't lost.
  const latest = await deps.storage.get("chats", input.chatId);
  const runs = [...readRuns(isRecord(latest) ? latest.metadata : chat.metadata), run].slice(-FANFIC_QUALITY_MAX_RUNS);
  await deps.storage.patchChatMetadata(input.chatId, { fanficQuality: { runs } });
  return run;
}
