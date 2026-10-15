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

/** Stored on the chat as `metadata.fanfic`. */
export interface FanficState {
  version: 1;
  request: FanficRequest;
  outline: FanficOutline | null;
  /** True once the requester accepted the outline (or skipped review). */
  outlineApproved: boolean;
}
