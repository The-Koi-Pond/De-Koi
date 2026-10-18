import {
  FANFIC_POVS,
  FANFIC_RATINGS,
  FANFIC_SETTINGS,
  FANFIC_TENSES,
  FANFIC_WARNINGS,
  type FanficOutline,
  type FanficOutlineChapter,
  type FanficPov,
  type FanficRating,
  type FanficRequest,
  type FanficResearch,
  type FanficResearchSource,
  type FanficSetting,
  type FanficState,
  type FanficTense,
  type FanficVoiceSheet,
  type FanficWarning,
} from "../../contracts/types/fanfic";
import { parseJsonObject } from "../../core/json";

const FANFIC_MIN_CHAPTERS = 1;
export const FANFIC_MAX_CHAPTERS = 30;
export const FANFIC_MIN_WORDS_PER_CHAPTER = 500;
export const FANFIC_MAX_WORDS_PER_CHAPTER = 6000;
const MAX_LIST_ITEMS = 24;
const MAX_ITEM_LENGTH = 120;

export const FANFIC_RATING_LABELS: Record<FanficRating, string> = {
  general: "General Audiences",
  teen: "Teen And Up Audiences",
  mature: "Mature",
  explicit: "Explicit",
};

export const FANFIC_WARNING_LABELS: Record<FanficWarning, string> = {
  graphic_violence: "Graphic Depictions Of Violence",
  major_character_death: "Major Character Death",
};

export const FANFIC_SETTING_LABELS: Record<FanficSetting, string> = {
  canon: "Canon compliant",
  canon_divergence: "Canon divergence",
  alternate_universe: "Alternate universe",
};

export const FANFIC_POV_LABELS: Record<FanficPov, string> = {
  first: "First person",
  second: "Second person",
  third_limited: "Third person limited",
  third_omniscient: "Third person omniscient",
};

export const FANFIC_TENSE_LABELS: Record<FanficTense, string> = {
  past: "Past tense",
  present: "Present tense",
};

export function defaultFanficRequest(): FanficRequest {
  return {
    fandom: "",
    characters: [],
    relationships: [],
    rating: "teen",
    warnings: [],
    tags: [],
    setting: "canon",
    settingNotes: "",
    pov: "third_limited",
    povCharacter: "",
    tense: "past",
    chapterCount: 3,
    wordsPerChapter: 2000,
    prompt: "",
    styleNotes: "",
    reviewOutline: true,
    adultsConfirmed: false,
    research: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of raw) {
    const item = text(entry, MAX_ITEM_LENGTH);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Coerces stored or submitted request data into a complete request. */
export function normalizeFanficRequest(raw: unknown): FanficRequest {
  const defaults = defaultFanficRequest();
  const record = isRecord(raw) ? raw : {};
  const warnings = Array.isArray(record.warnings)
    ? FANFIC_WARNINGS.filter((warning) => (record.warnings as unknown[]).includes(warning))
    : [];
  return {
    fandom: text(record.fandom, 200),
    characters: textList(record.characters),
    relationships: textList(record.relationships),
    rating: oneOf(record.rating, FANFIC_RATINGS, defaults.rating),
    warnings,
    tags: textList(record.tags),
    setting: oneOf(record.setting, FANFIC_SETTINGS, defaults.setting),
    settingNotes: text(record.settingNotes, 2000),
    pov: oneOf(record.pov, FANFIC_POVS, defaults.pov),
    povCharacter: text(record.povCharacter, MAX_ITEM_LENGTH),
    tense: oneOf(record.tense, FANFIC_TENSES, defaults.tense),
    chapterCount: boundedInt(record.chapterCount, FANFIC_MIN_CHAPTERS, FANFIC_MAX_CHAPTERS, defaults.chapterCount),
    wordsPerChapter: boundedInt(
      record.wordsPerChapter,
      FANFIC_MIN_WORDS_PER_CHAPTER,
      FANFIC_MAX_WORDS_PER_CHAPTER,
      defaults.wordsPerChapter,
    ),
    prompt: text(record.prompt, 6000),
    styleNotes: text(record.styleNotes, 4000),
    reviewOutline: typeof record.reviewOutline === "boolean" ? record.reviewOutline : defaults.reviewOutline,
    adultsConfirmed: record.adultsConfirmed === true,
    // Requests saved before research existed never opted in.
    research: record.research === true,
  };
}

export function fanficRatingAllowsSexualContent(rating: FanficRating): boolean {
  return rating === "mature" || rating === "explicit";
}

/** Problems that block writing; empty when the request can be sent. */
export function fanficRequestProblems(request: FanficRequest): string[] {
  const problems: string[] = [];
  if (!request.fandom) problems.push("Name the fandom.");
  if (!request.prompt && request.characters.length === 0 && request.relationships.length === 0) {
    problems.push("Add a prompt, characters, or a relationship so there is something to write.");
  }
  if (fanficRatingAllowsSexualContent(request.rating) && !request.adultsConfirmed) {
    problems.push("Mature and Explicit fics need confirmation that every character in sexual content is an adult.");
  }
  return problems;
}

function normalizeOutlineChapter(raw: unknown, index: number): FanficOutlineChapter | null {
  if (!isRecord(raw)) return null;
  const title = text(raw.title, 200);
  const summary = text(raw.summary ?? raw.beats ?? raw.description, 2000);
  if (!title && !summary) return null;
  return { number: index + 1, title: title || `Chapter ${index + 1}`, summary };
}

export function normalizeFanficOutline(raw: unknown): FanficOutline | null {
  if (!isRecord(raw)) return null;
  const chapters = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .map((chapter, index) => normalizeOutlineChapter(chapter, index))
    .filter((chapter): chapter is FanficOutlineChapter => !!chapter)
    .slice(0, FANFIC_MAX_CHAPTERS)
    .map((chapter, index) => ({ ...chapter, number: index + 1 }));
  if (chapters.length === 0) return null;
  return {
    title: text(raw.title, 200) || "Untitled",
    summary: text(raw.summary, 2000),
    chapters,
  };
}

const MAX_RESEARCH_SOURCES = 12;
export const FANFIC_RESEARCH_NOTES_MAX = 12_000;

export function normalizeFanficResearch(raw: unknown): FanficResearch | null {
  if (!isRecord(raw)) return null;
  const notes = text(raw.notes, FANFIC_RESEARCH_NOTES_MAX);
  if (!notes) return null;
  const sources: FanficResearchSource[] = (Array.isArray(raw.sources) ? raw.sources : [])
    .filter(isRecord)
    .map((source) => ({ title: text(source.title, 300), url: text(source.url, 2000) }))
    .filter((source) => /^https?:\/\//i.test(source.url))
    .slice(0, MAX_RESEARCH_SOURCES);
  return { notes, sources, fromWeb: raw.fromWeb === true && sources.length > 0 };
}

export const FANFIC_VOICE_LIMITS = {
  sheets: 8,
  name: 80,
  speech: 1200,
  motives: 800,
  /** What the model is asked for; the requester can add more, up to neverSays. */
  askNeverSays: 12,
  neverSays: 30,
  neverSaysItem: 120,
  quotes: 6,
  quote: 400,
} as const;

/** Stored voice sheets, cleaned; sheets without a name are dropped. */
export function normalizeFanficVoices(raw: unknown): FanficVoiceSheet[] {
  if (!Array.isArray(raw)) return [];
  const L = FANFIC_VOICE_LIMITS;
  const seen = new Set<string>();
  const sheets: FanficVoiceSheet[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = text(entry.name, L.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    sheets.push({
      name,
      speech: text(entry.speech, L.speech),
      neverSays: (Array.isArray(entry.neverSays) ? entry.neverSays : [])
        .map((item) => text(item, L.neverSaysItem))
        .filter(Boolean)
        .slice(0, L.neverSays),
      motives: text(entry.motives, L.motives),
      quotes: (Array.isArray(entry.quotes) ? entry.quotes : [])
        .filter(isRecord)
        .map((quote) => ({
          text: text(quote.text, L.quote),
          source: text(quote.source, 300),
          url: text(quote.url, 2000),
        }))
        .filter((quote) => quote.text && /^https?:\/\//i.test(quote.url))
        .slice(0, L.quotes),
    });
    if (sheets.length >= L.sheets) break;
  }
  return sheets;
}

/** Reads `metadata.fanfic`; null until a request has been saved. */
export function readFanficState(metadata: unknown): FanficState | null {
  const raw = parseJsonObject(metadata).fanfic;
  if (!isRecord(raw) || !isRecord(raw.request)) return null;
  const outline = normalizeFanficOutline(raw.outline);
  return {
    version: 1,
    request: normalizeFanficRequest(raw.request),
    outline,
    outlineApproved: !!outline && raw.outlineApproved === true,
    research: normalizeFanficResearch(raw.research),
    voices: normalizeFanficVoices(raw.voices),
  };
}

export function createFanficState(request: FanficRequest): FanficState {
  return {
    version: 1,
    request: normalizeFanficRequest(request),
    outline: null,
    outlineApproved: false,
    research: null,
  };
}

export type FanficStage = "request" | "outline" | "outline_review" | "writing";

export function fanficStage(state: FanficState | null): FanficStage {
  if (!state) return "request";
  if (!state.outline) return "outline";
  return state.outlineApproved ? "writing" : "outline_review";
}

/** Output budget for one chapter: room for the prose plus model overhead. */
export function fanficChapterMaxTokens(request: FanficRequest): number {
  return Math.min(32_000, Math.max(4096, Math.ceil(request.wordsPerChapter * 2) + 2048));
}
