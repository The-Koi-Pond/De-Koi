// ──────────────────────────────────────────────
// Trance Mode Types
// ──────────────────────────────────────────────

/** How intense the session is, as hypnosis files label it. */
export const TRANCE_TYPES = ["gentle", "erotic", "kinky"] as const;
export type TranceType = (typeof TRANCE_TYPES)[number];

/** What the session is for. */
export const TRANCE_CATEGORIES = ["relax", "sleep", "fantasy", "transformation", "effect"] as const;
export type TranceCategory = (typeof TRANCE_CATEGORIES)[number];

/** Optional techniques and themes the requester opts into. */
export const TRANCE_FEATURES = ["fractionation", "amnesia", "obedience", "arousal", "orgasm"] as const;
export type TranceFeature = (typeof TRANCE_FEATURES)[number];

/** Features that only fit an erotic or kinky session. */
export const TRANCE_SEXUAL_FEATURES: readonly TranceFeature[] = ["arousal", "orgasm"];

/** How the requester feels before the session (any number of them); the script opens from it. */
export const TRANCE_MOODS = [
  "calm",
  "good",
  "anxious",
  "stressed",
  "overwhelmed",
  "wired",
  "tired",
  "sad",
  "low",
  "lonely",
  "numb",
  "foggy",
  "blank",
] as const;
export type TranceMood = (typeof TRANCE_MOODS)[number];

export const TRANCE_LENGTHS = [5, 10, 20, 30] as const;
export type TranceLength = (typeof TRANCE_LENGTHS)[number];

/** Wake up with a count, or drift off into sleep. */
export const TRANCE_ENDINGS = ["wake", "sleep"] as const;
export type TranceEnding = (typeof TRANCE_ENDINGS)[number];

/** A session idea the requester picked from suggestions or a preview; the script opens with its sample lines. */
export interface TrancePitchChoice {
  title: string;
  summary: string;
  /** The first lines of the session, as shown in the preview. */
  sample: string[];
}

export interface TranceRequest {
  type: TranceType;
  category: TranceCategory;
  features: TranceFeature[];
  /** Empty when the requester didn't pick any. */
  moods: TranceMood[];
  /** How they feel in their own words, alone or beside the picked moods. */
  moodNote: string;
  /** A theme or image for the session ("a puppet put away in a box"). */
  idea: string;
  minutes: TranceLength;
  ending: TranceEnding;
  /** The picked idea, when the request came from a suggestion or preview; null when built by hand. */
  pitch: TrancePitchChoice | null;
}

/** The parts of a session, in reading order. `wake` and `sleep` are the two possible endings. */
export const TRANCE_PHASES = ["pretalk", "induction", "deepener", "suggestions", "wake", "sleep"] as const;
export type TrancePhase = (typeof TRANCE_PHASES)[number];

export interface TranceLine {
  phase: TrancePhase;
  text: string;
}

/** Short scripts the listener can leave the session through at any line. */
export interface TranceExits {
  /** A short count up and out. Also replayed when someone isn't fully awake afterwards. */
  gentle: string[];
  /** Calm and safety first, for someone who got upset, then a count up. */
  calm: string[];
}

export interface TranceScript {
  lines: TranceLine[];
  exits: TranceExits;
  /** The connection that wrote it, for the session's details. */
  connectionId: string | null;
  createdAt: string;
}

/** How the listener left a run of the session. */
export type TranceFinish = "completed" | "gentle" | "calm" | "stop";

/** What the listener said after a run. */
export interface TranceAfter {
  finishedBy: TranceFinish;
  /** 1-10, or null when they skipped it. */
  rating: number | null;
  /** False when they said they weren't fully awake (they were then walked back up). */
  fullyAwake: boolean | null;
  note: string;
  /** Seconds from Start to the last line read (or the way out finishing); null when unknown. */
  seconds: number | null;
  at: string;
}

export interface TranceState {
  version: 1;
  request: TranceRequest;
  script: TranceScript | null;
  /** Newest first. */
  runs: TranceAfter[];
}
