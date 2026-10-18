// ──────────────────────────────────────────────
// Fanfic Mode Types
// ──────────────────────────────────────────────

/** AO3-style content ratings, mildest first. */
export const FANFIC_RATINGS = ["general", "teen", "mature", "explicit"] as const;
export type FanficRating = (typeof FANFIC_RATINGS)[number];

/** Archive-style warnings the requester can opt into. */
export const FANFIC_WARNINGS = ["graphic_violence", "major_character_death"] as const;
export type FanficWarning = (typeof FANFIC_WARNINGS)[number];

export const FANFIC_SETTINGS = ["canon", "canon_divergence", "alternate_universe"] as const;
export type FanficSetting = (typeof FANFIC_SETTINGS)[number];

export const FANFIC_POVS = ["first", "second", "third_limited", "third_omniscient"] as const;
export type FanficPov = (typeof FANFIC_POVS)[number];

export const FANFIC_TENSES = ["past", "present"] as const;
export type FanficTense = (typeof FANFIC_TENSES)[number];

/** What the requester asked for, in the shape of an AO3 prompt. */
export interface FanficRequest {
  fandom: string;
  /** Characters by name; linked library cards are the chat's characterIds. */
  characters: string[];
  /** "A/B" for romantic pairings, "A & B" for platonic ones. */
  relationships: string[];
  rating: FanficRating;
  warnings: FanficWarning[];
  /** Freeform tropes and tags. */
  tags: string[];
  setting: FanficSetting;
  settingNotes: string;
  pov: FanficPov;
  povCharacter: string;
  tense: FanficTense;
  /** 1 means a one-shot. */
  chapterCount: number;
  wordsPerChapter: number;
  prompt: string;
  /** Style notes or a short sample of the prose voice the requester wants. */
  styleNotes: string;
  /** When true the outline waits for the requester before chapter 1 is written. */
  reviewOutline: boolean;
  /** The requester confirmed every character in sexual content is an adult (required for mature/explicit). */
  adultsConfirmed: boolean;
  /** Look up the canon and real-world details online before planning. */
  research: boolean;
}

export interface FanficOutlineChapter {
  number: number;
  title: string;
  summary: string;
}

export interface FanficOutline {
  title: string;
  summary: string;
  chapters: FanficOutlineChapter[];
}

export interface FanficResearchSource {
  title: string;
  url: string;
}

/** What the fic should get right, gathered before planning. */
export interface FanficResearch {
  /** Notes the outline and chapters lean on; the requester can edit them. */
  notes: string;
  sources: FanficResearchSource[];
  /** False when no web page could be read, so the notes come from the model's own knowledge. */
  fromWeb: boolean;
}

/** A canon line, copied word for word from a page research read. */
export interface FanficVoiceQuote {
  text: string;
  source: string;
  url: string;
}

/** How one character talks, kept so the chapters (and the voice check) hold them to it. */
export interface FanficVoiceSheet {
  name: string;
  /** Rhythm, register, verbal habits, what they call people. */
  speech: string;
  /** Words, phrases, and registers they would never use. */
  neverSays: string[];
  /** What drives their choices in canon, so their lines come from the right place. */
  motives: string;
  quotes: FanficVoiceQuote[];
}

/** Stored on the chat as `metadata.fanfic`. */
export interface FanficState {
  version: 1;
  request: FanficRequest;
  outline: FanficOutline | null;
  /** True once the requester accepted the outline (or skipped review). */
  outlineApproved: boolean;
  /** Present once research ran for this fic. */
  research: FanficResearch | null;
  /** Voice sheets, one per named character, once built. The requester can edit them. */
  voices?: FanficVoiceSheet[];
}

// ── Quality check ───────────────────────────────

export type FanficQualityGroupId = "creativity" | "coherence" | "character" | "prose";

export type FanficQualityCriterionId =
  | "compelling_plot"
  | "world_building"
  | "earned_tone"
  | "uncreative"
  | "coherent"
  | "pacing"
  | "faithful"
  | "unearned_transformations"
  | "believable_actions"
  | "nuanced_characters"
  | "emotionally_engaging"
  | "weak_dialogue"
  | "tell_dont_show"
  | "purple_prose"
  | "forced_poetry"
  | "amateurish";

/** ConStory-Bench's five contradiction categories. */
export const FANFIC_CONTINUITY_CATEGORIES = ["timeline", "character", "world", "detail", "narrative"] as const;
export type FanficContinuityCategory = (typeof FANFIC_CONTINUITY_CATEGORIES)[number];

/** Two passages that can't both be true, each quoted from the fic. */
export interface FanficContinuityIssue {
  category: FanficContinuityCategory;
  subtype: string;
  earlierChapter: number;
  earlierQuote: string;
  laterChapter: number;
  laterQuote: string;
  explanation: string;
}

export interface FanficQualityMechanics {
  words: number;
  aiTellHits: number;
  aiTellsPer1k: number;
  topTells: Array<{ label: string; count: number }>;
  /** Uses of the pet names, details, and phrases the whole fic overuses. */
  repeatUses: number;
  repeatUsesPer1k: number;
  repeats: Array<{ kind: "pet_name" | "detail" | "phrase"; term: string; count: number }>;
}

export interface FanficQualityRun {
  id: string;
  createdAt: string;
  label: string;
  /** Runs with different judge versions or models aren't directly comparable. */
  judgeVersion: number;
  judge: { connectionId: string; connectionName: string; model: string };
  chapterCount: number;
  /** Fingerprint of the chapter text that was scored. */
  textKey: string;
  mechanics: FanficQualityMechanics;
  rubric: {
    /** Raw 0-20 judge scores; fault criteria are higher-is-worse. */
    criteria: Record<FanficQualityCriterionId, number>;
    /** 0-10, faults inverted. */
    groups: Record<FanficQualityGroupId, number>;
    overall: number;
    analysis: string;
    /** Judge reads averaged into these scores. */
    passes: number;
    /** Gap between the reads' overall scores: changes smaller than this are noise. */
    spread: number;
  };
  continuity: {
    /** Confirmed contradictions. */
    issues: FanficContinuityIssue[];
    /** What the first pass listed. */
    candidates: number;
    /** Listed with quotes that aren't in the fic. */
    ungrounded: number;
    /** Quoted correctly but the second read found no contradiction. */
    rejected: number;
    /** The same contradiction as another note, reported again. */
    merged: number;
    /** Confirmed contradictions per 10,000 words. */
    per10k: number;
  };
}

/** Stored on the chat as `metadata.fanficQuality`, apart from `metadata.fanfic` so fic edits never drop it. */
export interface FanficQualityStore {
  runs: FanficQualityRun[];
}

// ── Story ledger ────────────────────────────────

/** One fact in the ledger: who or what it is about, and what is true. */
export interface FanficLedgerFact {
  subject: string;
  detail: string;
}

/** What a writer must keep straight, as of the end of one chapter. */
export interface FanficLedgerEntry {
  chapter: number;
  /** The chapter message and the exact text this entry was built from; a rewrite makes it stale. */
  messageId: string;
  textKey: string;
  /** What happens in this chapter. */
  summary: string;
  /** When the chapter ends, relative to the story's start and the chapter before. */
  timeline: string;
  /** Secrets, names, plans: who knows what, and who doesn't know yet. */
  knowledge: FanficLedgerFact[];
  /** Injuries, clothing, objects (who has what, where), and where people are. */
  conditions: FanficLedgerFact[];
  /** Pairs and where they stand. */
  relationships: FanficLedgerFact[];
  /** Promises, questions, and plans the story hasn't resolved. */
  openThreads: string[];
}

/** Stored on the chat as `metadata.fanficLedger`, one entry per chapter in order. */
export interface FanficLedger {
  version: 1;
  entries: FanficLedgerEntry[];
}
