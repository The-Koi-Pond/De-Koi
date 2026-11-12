// ──────────────────────────────────────────────
// Trance mode: the request and the stored session state
// ──────────────────────────────────────────────
import {
  TRANCE_CATEGORIES,
  TRANCE_ENDINGS,
  TRANCE_FEATURES,
  TRANCE_LENGTHS,
  TRANCE_MOODS,
  TRANCE_PHASES,
  TRANCE_SEXUAL_FEATURES,
  TRANCE_TYPES,
  type TranceAfter,
  type TranceCategory,
  type TranceEnding,
  type TranceExits,
  type TranceFeature,
  type TranceFinish,
  type TranceLength,
  type TranceLine,
  type TranceMood,
  type TranceRequest,
  type TranceScript,
  type TranceState,
  type TranceType,
} from "../../contracts/types/trance";
import { isRecord, readString } from "../../generation/runtime-records";

export const TRANCE_TYPE_LABELS: Record<TranceType, string> = {
  gentle: "Gentle",
  erotic: "Erotic",
  kinky: "Kinky",
};

export const TRANCE_CATEGORY_LABELS: Record<TranceCategory, string> = {
  relax: "Relax",
  sleep: "Sleep",
  fantasy: "Fantasy",
  transformation: "Transformation",
  effect: "Effect",
};

export const TRANCE_FEATURE_LABELS: Record<TranceFeature, string> = {
  fractionation: "Fractionation",
  amnesia: "Amnesia",
  obedience: "Obedience",
  arousal: "Arousal",
  orgasm: "Orgasm",
};

export const TRANCE_MOOD_LABELS: Record<TranceMood, string> = {
  calm: "Calm",
  anxious: "Anxious",
  wired: "Wired",
  tired: "Tired",
  low: "Low",
  foggy: "Foggy",
  blank: "Just want to blank out",
};

export const TRANCE_ENDING_LABELS: Record<TranceEnding, string> = {
  wake: "Wake up",
  sleep: "Drift to sleep",
};

/** Max characters in the free-text fields, so a pasted wall of text can't crowd out the instructions. */
export const TRANCE_NOTE_LIMIT = 600;

/**
 * Lines per minute of session: one short line read slowly, a beat to let it land, and a press. The estimate the
 * script length and the shown length both come from.
 */
const TRANCE_LINES_PER_MINUTE = 10;

export function tranceTargetLines(minutes: number): number {
  return Math.round(minutes * TRANCE_LINES_PER_MINUTE);
}

/** About how long a script reads, in whole minutes (at least 1). */
export function tranceEstimatedMinutes(lineCount: number): number {
  return Math.max(1, Math.round(lineCount / TRANCE_LINES_PER_MINUTE));
}

/** A session's tags in one line, e.g. "Gentle · Relax · Fractionation". */
export function tranceTagSummary(request: TranceRequest): string {
  return [
    TRANCE_TYPE_LABELS[request.type],
    TRANCE_CATEGORY_LABELS[request.category],
    ...request.features.map((feature) => TRANCE_FEATURE_LABELS[feature]),
  ].join(" · ");
}

export function defaultTranceRequest(): TranceRequest {
  return {
    type: "gentle",
    category: "relax",
    features: [],
    mood: "",
    moodNote: "",
    idea: "",
    minutes: 10,
    ending: "wake",
  };
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clip(value: unknown): string {
  return readString(value).trim().slice(0, TRANCE_NOTE_LIMIT);
}

/** Features the session's type allows: arousal and orgasm only fit erotic or kinky sessions. */
export function tranceFeaturesForType(type: TranceType, features: readonly TranceFeature[]): TranceFeature[] {
  const allowed = new Set<TranceFeature>(
    type === "gentle"
      ? TRANCE_FEATURES.filter((feature) => !TRANCE_SEXUAL_FEATURES.includes(feature))
      : TRANCE_FEATURES,
  );
  return TRANCE_FEATURES.filter((feature) => allowed.has(feature) && features.includes(feature));
}

export function normalizeTranceRequest(value: unknown): TranceRequest {
  const defaults = defaultTranceRequest();
  const record = isRecord(value) ? value : {};
  const type = oneOf(record.type, TRANCE_TYPES, defaults.type);
  const features = Array.isArray(record.features)
    ? record.features.filter((feature): feature is TranceFeature =>
        (TRANCE_FEATURES as readonly string[]).includes(feature as string),
      )
    : [];
  const minutes = TRANCE_LENGTHS.find((length) => length === record.minutes) ?? defaults.minutes;
  return {
    type,
    category: oneOf(record.category, TRANCE_CATEGORIES, defaults.category),
    features: tranceFeaturesForType(type, features),
    mood: record.mood === "" ? "" : oneOf<TranceMood | "">(record.mood, TRANCE_MOODS, ""),
    moodNote: clip(record.moodNote),
    idea: clip(record.idea),
    minutes: minutes as TranceLength,
    ending: oneOf(record.ending, TRANCE_ENDINGS, defaults.ending),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item).trim()).filter((item) => item.length > 0) : [];
}

function normalizeLines(value: unknown): TranceLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const text = readString(item.text).trim();
    const phase = oneOf(item.phase, TRANCE_PHASES, "induction");
    return text ? [{ phase, text }] : [];
  });
}

function normalizeExits(value: unknown): TranceExits {
  const record = isRecord(value) ? value : {};
  return { gentle: stringList(record.gentle), calm: stringList(record.calm) };
}

function normalizeScript(value: unknown): TranceScript | null {
  if (!isRecord(value)) return null;
  const lines = normalizeLines(value.lines);
  if (lines.length === 0) return null;
  return {
    lines,
    exits: normalizeExits(value.exits),
    connectionId: readString(value.connectionId).trim() || null,
    createdAt: readString(value.createdAt),
  };
}

const TRANCE_FINISHES: readonly TranceFinish[] = ["completed", "gentle", "calm", "stop"];

function normalizeRun(value: unknown): TranceAfter | null {
  if (!isRecord(value)) return null;
  const rating =
    typeof value.rating === "number" && Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 10
      ? value.rating
      : null;
  return {
    finishedBy: oneOf(value.finishedBy, TRANCE_FINISHES, "completed"),
    rating,
    fullyAwake: typeof value.fullyAwake === "boolean" ? value.fullyAwake : null,
    note: clip(value.note),
    seconds:
      typeof value.seconds === "number" && Number.isFinite(value.seconds) && value.seconds >= 0
        ? Math.round(value.seconds)
        : null,
    at: readString(value.at),
  };
}

/** The session state stored on `metadata.trance`, or null when the request hasn't been filled in. */
export function readTranceState(metadata: unknown): TranceState | null {
  const record = isRecord(metadata) ? metadata.trance : null;
  if (!isRecord(record) || !isRecord(record.request)) return null;
  return {
    version: 1,
    request: normalizeTranceRequest(record.request),
    script: normalizeScript(record.script),
    runs: Array.isArray(record.runs) ? record.runs.map(normalizeRun).filter((run) => run !== null) : [],
  };
}

export function createTranceState(request: TranceRequest): TranceState {
  return { version: 1, request: normalizeTranceRequest(request), script: null, runs: [] };
}

export type TranceStage = "request" | "script" | "ready";

/** Where a session stands: no request yet, request but no script, or ready to play. */
export function tranceStage(state: TranceState | null): TranceStage {
  if (!state) return "request";
  return state.script ? "ready" : "script";
}

/** Keeps the last runs only; older ones say nothing new. */
export const TRANCE_RUN_LIMIT = 20;

export function withTranceRun(state: TranceState, run: TranceAfter): TranceState {
  const normalized = normalizeRun(run);
  if (!normalized) return state;
  return { ...state, runs: [normalized, ...state.runs].slice(0, TRANCE_RUN_LIMIT) };
}
