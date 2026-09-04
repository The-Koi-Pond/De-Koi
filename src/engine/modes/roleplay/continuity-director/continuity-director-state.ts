import type {
  ContinuityDirectorArc,
  ContinuityDirectorBeat,
  ContinuityDirectorBeatStatus,
  ContinuityDirectorCommand,
  ContinuityDirectorItemSource,
  ContinuityDirectorRefreshMode,
  ContinuityDirectorSourceSnapshot,
  ContinuityDirectorThread,
  ContinuityDirectorThreadStatus,
  RoleplayContinuityDirectorState,
} from "../../../contracts/types/roleplay-continuity-director";
import { createId } from "../../../core/ids";

export const CONTINUITY_DIRECTOR_LIMITS = {
  arcCharacters: 600,
  itemCharacters: 280,
  proposedBeatsPerRefresh: 8,
  retainedBeats: 20,
  openThreads: 12,
} as const;

export const CONTINUITY_DIRECTOR_CADENCE_OPTIONS = [5, 10, 20] as const;

export type ContinuityDirectorCadence = (typeof CONTINUITY_DIRECTOR_CADENCE_OPTIONS)[number];

export interface ContinuityDirectorCommandOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface ContinuityDirectorConfiguration {
  enabled: boolean;
  refreshMode: ContinuityDirectorRefreshMode;
  refreshEveryAssistantTurns: ContinuityDirectorCadence | null;
  connectionId: string | null;
  hasSourceSnapshot: boolean;
  hasPlan: boolean;
}

const BEAT_STATUSES = new Set<ContinuityDirectorBeatStatus>([
  "proposed",
  "approved",
  "deferred",
  "rejected",
  "fulfilled",
]);
const THREAD_STATUSES = new Set<ContinuityDirectorThreadStatus>(["open", "deferred", "resolved"]);
const ITEM_SOURCES = new Set<ContinuityDirectorItemSource>(["director", "user"]);
const REFRESH_MODES = new Set<ContinuityDirectorRefreshMode>(["manual", "scene_events", "cadence"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function cadence(value: unknown): ContinuityDirectorCadence {
  return CONTINUITY_DIRECTOR_CADENCE_OPTIONS.includes(value as ContinuityDirectorCadence)
    ? (value as ContinuityDirectorCadence)
    : 10;
}

function normalizeArc(value: unknown, fallbackAt: string): ContinuityDirectorArc | null {
  if (!isRecord(value)) return null;
  const text = boundedText(value.text, CONTINUITY_DIRECTOR_LIMITS.arcCharacters);
  const id = boundedText(value.id, 200);
  if (!text || !id) return null;
  const source = ITEM_SOURCES.has(value.source as ContinuityDirectorItemSource)
    ? (value.source as ContinuityDirectorItemSource)
    : "director";
  return {
    id,
    text,
    source,
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
    updatedAt: boundedText(value.updatedAt, 80) || fallbackAt,
  };
}

function normalizeThread(value: unknown, fallbackAt: string): ContinuityDirectorThread | null {
  if (!isRecord(value)) return null;
  const text = boundedText(value.text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters);
  const id = boundedText(value.id, 200);
  if (!text || !id) return null;
  return {
    id,
    text,
    status: THREAD_STATUSES.has(value.status as ContinuityDirectorThreadStatus)
      ? (value.status as ContinuityDirectorThreadStatus)
      : "open",
    source: ITEM_SOURCES.has(value.source as ContinuityDirectorItemSource)
      ? (value.source as ContinuityDirectorItemSource)
      : "director",
    sourceIds: stringArray(value.sourceIds),
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
    updatedAt: boundedText(value.updatedAt, 80) || fallbackAt,
  };
}

function normalizeBeat(value: unknown, fallbackAt: string, fallbackOrder: number): ContinuityDirectorBeat | null {
  if (!isRecord(value)) return null;
  const text = boundedText(value.text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters);
  const id = boundedText(value.id, 200);
  if (!text || !id) return null;
  return {
    id,
    text,
    status: BEAT_STATUSES.has(value.status as ContinuityDirectorBeatStatus)
      ? (value.status as ContinuityDirectorBeatStatus)
      : "proposed",
    order: integer(value.order, fallbackOrder),
    source: ITEM_SOURCES.has(value.source as ContinuityDirectorItemSource)
      ? (value.source as ContinuityDirectorItemSource)
      : "director",
    sourceIds: stringArray(value.sourceIds),
    characterIds: stringArray(value.characterIds),
    threadIds: stringArray(value.threadIds),
    ...(value.resolution === "rerolled" ? { resolution: "rerolled" as const } : {}),
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
    updatedAt: boundedText(value.updatedAt, 80) || fallbackAt,
  };
}

function normalizeSourceSnapshot(value: unknown): ContinuityDirectorSourceSnapshot | null {
  if (!isRecord(value)) return null;
  const fingerprint = boundedText(value.fingerprint, 200);
  const generatedAt = boundedText(value.generatedAt, 80);
  if (!fingerprint || !generatedAt) return null;
  return {
    storyProjectionIds: stringArray(value.storyProjectionIds),
    knowledgeEdgeIds: stringArray(value.knowledgeEdgeIds),
    lastMessageId: typeof value.lastMessageId === "string" ? value.lastMessageId.trim() || null : null,
    visibleAssistantTurnCount: integer(value.visibleAssistantTurnCount),
    fingerprint,
    generatedAt,
  };
}

function reindex(beats: ContinuityDirectorBeat[]): ContinuityDirectorBeat[] {
  return beats.map((beat, order) => (beat.order === order ? beat : { ...beat, order }));
}

export function createDefaultContinuityDirectorState(now = new Date().toISOString()): RoleplayContinuityDirectorState {
  return {
    version: 1,
    revision: 0,
    enabled: false,
    connectionId: null,
    refreshMode: "manual",
    refreshEveryAssistantTurns: null,
    currentArc: null,
    openThreads: [],
    beats: [],
    sourceSnapshot: null,
    lastPlanningAttemptAssistantTurnCount: null,
    updatedAt: now,
  };
}

export function normalizeContinuityDirectorState(
  value: unknown,
  now = new Date().toISOString(),
): RoleplayContinuityDirectorState {
  if (!isRecord(value) || value.version !== 1) return createDefaultContinuityDirectorState(now);

  const refreshMode = REFRESH_MODES.has(value.refreshMode as ContinuityDirectorRefreshMode)
    ? (value.refreshMode as ContinuityDirectorRefreshMode)
    : "manual";
  const everyTurns = cadence(value.refreshEveryAssistantTurns);
  const threads = (Array.isArray(value.openThreads) ? value.openThreads : [])
    .map((thread) => normalizeThread(thread, now))
    .filter((thread): thread is ContinuityDirectorThread => thread !== null)
    .slice(0, CONTINUITY_DIRECTOR_LIMITS.openThreads);
  const beats = (Array.isArray(value.beats) ? value.beats : [])
    .map((beat, index) => normalizeBeat(beat, now, index))
    .filter((beat): beat is ContinuityDirectorBeat => beat !== null)
    .sort((left, right) => left.order - right.order)
    .slice(0, CONTINUITY_DIRECTOR_LIMITS.retainedBeats);

  return {
    version: 1,
    revision: integer(value.revision),
    enabled: value.enabled === true,
    connectionId: typeof value.connectionId === "string" ? value.connectionId.trim() || null : null,
    refreshMode,
    refreshEveryAssistantTurns: refreshMode === "cadence" ? everyTurns : null,
    currentArc: normalizeArc(value.currentArc, now),
    openThreads: threads,
    beats: reindex(beats),
    sourceSnapshot: normalizeSourceSnapshot(value.sourceSnapshot),
    lastPlanningAttemptAssistantTurnCount: optionalInteger(value.lastPlanningAttemptAssistantTurnCount),
    updatedAt: boundedText(value.updatedAt, 80) || now,
  };
}

export function recordContinuityDirectorPlanningAttempt(
  input: RoleplayContinuityDirectorState,
  visibleAssistantTurnCount: number,
  options: ContinuityDirectorCommandOptions = {},
): RoleplayContinuityDirectorState {
  const now = options.now?.() ?? new Date().toISOString();
  const state = normalizeContinuityDirectorState(input, now);
  return {
    ...state,
    lastPlanningAttemptAssistantTurnCount: integer(visibleAssistantTurnCount),
    revision: state.revision + 1,
    updatedAt: now,
  };
}

export function readContinuityDirectorConfiguration(value: unknown): ContinuityDirectorConfiguration {
  const state = normalizeContinuityDirectorState(value);
  return {
    enabled: state.enabled,
    refreshMode: state.refreshMode,
    refreshEveryAssistantTurns: state.refreshMode === "cadence" ? cadence(state.refreshEveryAssistantTurns) : null,
    connectionId: state.connectionId,
    hasSourceSnapshot: state.sourceSnapshot !== null,
    hasPlan:
      state.sourceSnapshot !== null ||
      state.currentArc !== null ||
      state.openThreads.length > 0 ||
      state.beats.length > 0,
  };
}

export function applyContinuityDirectorConfiguration(
  state: RoleplayContinuityDirectorState,
  patch: Partial<Pick<RoleplayContinuityDirectorState, "enabled" | "refreshMode" | "refreshEveryAssistantTurns">>,
  options: ContinuityDirectorCommandOptions = {},
): RoleplayContinuityDirectorState {
  const refreshMode = patch.refreshMode ?? state.refreshMode;
  const refreshEveryAssistantTurns =
    refreshMode === "cadence" ? cadence(patch.refreshEveryAssistantTurns ?? state.refreshEveryAssistantTurns) : null;
  const next = {
    ...state,
    enabled: patch.enabled ?? state.enabled,
    refreshMode,
    refreshEveryAssistantTurns,
  };
  if (
    next.enabled === state.enabled &&
    next.refreshMode === state.refreshMode &&
    next.refreshEveryAssistantTurns === state.refreshEveryAssistantTurns
  )
    return state;
  const now = options.now?.() ?? new Date().toISOString();
  return { ...next, revision: state.revision + 1, updatedAt: now };
}

export function countProposedContinuityDirectorBeats(value: unknown): number {
  return normalizeContinuityDirectorState(value).beats.filter((beat) => beat.status === "proposed").length;
}

function makeArc(text: string, now: string, makeId: (prefix: string) => string): ContinuityDirectorArc | null {
  const normalized = boundedText(text, CONTINUITY_DIRECTOR_LIMITS.arcCharacters);
  return normalized
    ? { id: makeId("continuity-arc"), text: normalized, source: "director", createdAt: now, updatedAt: now }
    : null;
}

function makeThread(text: string, now: string, makeId: (prefix: string) => string): ContinuityDirectorThread | null {
  const normalized = boundedText(text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters);
  return normalized
    ? {
        id: makeId("continuity-thread"),
        text: normalized,
        status: "open",
        source: "director",
        sourceIds: [],
        createdAt: now,
        updatedAt: now,
      }
    : null;
}

function makeBeat(
  text: string,
  order: number,
  now: string,
  makeId: (prefix: string) => string,
): ContinuityDirectorBeat | null {
  const normalized = boundedText(text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters);
  return normalized
    ? {
        id: makeId("continuity-beat"),
        text: normalized,
        status: "proposed",
        order,
        source: "director",
        sourceIds: [],
        characterIds: [],
        threadIds: [],
        createdAt: now,
        updatedAt: now,
      }
    : null;
}

export function applyContinuityDirectorCommand(
  input: RoleplayContinuityDirectorState,
  command: ContinuityDirectorCommand,
  options: ContinuityDirectorCommandOptions = {},
): RoleplayContinuityDirectorState {
  const now = options.now?.() ?? new Date().toISOString();
  const makeId = options.createId ?? createId;
  const state = normalizeContinuityDirectorState(input, now);
  let next: RoleplayContinuityDirectorState = state;

  switch (command.type) {
    case "set_enabled":
      next = { ...state, enabled: command.enabled };
      break;
    case "set_connection":
      next = { ...state, connectionId: command.connectionId?.trim() || null };
      break;
    case "set_refresh_policy":
      next = {
        ...state,
        refreshMode: command.mode,
        refreshEveryAssistantTurns: command.mode === "cadence" ? cadence(command.everyAssistantTurns) : null,
      };
      break;
    case "edit_arc": {
      const text = boundedText(command.text, CONTINUITY_DIRECTOR_LIMITS.arcCharacters);
      next = {
        ...state,
        currentArc: text
          ? state.currentArc
            ? { ...state.currentArc, text, source: "user", updatedAt: now }
            : { id: makeId("continuity-arc"), text, source: "user", createdAt: now, updatedAt: now }
          : null,
      };
      break;
    }
    case "edit_thread":
      next = {
        ...state,
        openThreads: state.openThreads.map((thread) =>
          thread.id === command.threadId
            ? {
                ...thread,
                text: boundedText(command.text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters) || thread.text,
                source: "user",
                updatedAt: now,
              }
            : thread,
        ),
      };
      break;
    case "set_thread_status":
      next = {
        ...state,
        openThreads: state.openThreads.map((thread) =>
          thread.id === command.threadId ? { ...thread, status: command.status, updatedAt: now } : thread,
        ),
      };
      break;
    case "edit_beat":
      next = {
        ...state,
        beats: state.beats.map((beat) =>
          beat.id === command.beatId
            ? {
                ...beat,
                text: boundedText(command.text, CONTINUITY_DIRECTOR_LIMITS.itemCharacters) || beat.text,
                source: "user",
                updatedAt: now,
              }
            : beat,
        ),
      };
      break;
    case "set_beat_status":
      next = {
        ...state,
        beats: state.beats.map((beat) =>
          beat.id === command.beatId
            ? { ...beat, status: command.status, resolution: undefined, updatedAt: now }
            : beat,
        ),
      };
      break;
    case "move_beat": {
      const from = state.beats.findIndex((beat) => beat.id === command.beatId);
      const to = command.direction === "up" ? from - 1 : from + 1;
      if (from >= 0 && to >= 0 && to < state.beats.length) {
        const beats = [...state.beats];
        [beats[from], beats[to]] = [beats[to], beats[from]];
        next = { ...state, beats: reindex(beats) };
      }
      break;
    }
    case "reroll_beat": {
      const targetIndex = state.beats.findIndex((beat) => beat.id === command.beatId);
      if (targetIndex < 0) break;
      const replacement = makeBeat(command.replacementText, state.beats.length, now, makeId);
      if (!replacement) break;
      const beats = [
        ...state.beats.map((beat) =>
          beat.id === command.beatId
            ? { ...beat, status: "rejected" as const, resolution: "rerolled" as const, updatedAt: now }
            : beat,
        ),
        replacement,
      ];
      if (beats.length > CONTINUITY_DIRECTOR_LIMITS.retainedBeats) {
        let dropIndex = beats.findIndex(
          (beat) =>
            beat.id !== command.beatId &&
            beat.id !== replacement.id &&
            (beat.status === "rejected" || beat.status === "fulfilled"),
        );
        if (dropIndex < 0) {
          for (let index = beats.length - 2; index >= 0; index -= 1) {
            if (beats[index]?.id !== command.beatId) {
              dropIndex = index;
              break;
            }
          }
        }
        if (dropIndex >= 0) beats.splice(dropIndex, 1);
      }
      next = {
        ...state,
        beats: reindex(beats.slice(0, CONTINUITY_DIRECTOR_LIMITS.retainedBeats)),
      };
      break;
    }
    case "replace_director_proposals": {
      const preservedThreads = state.openThreads.filter(
        (thread) => thread.source === "user" || thread.status !== "open",
      );
      const generatedThreads = (command.threads ?? [])
        .map((text) => makeThread(text, now, makeId))
        .filter((thread): thread is ContinuityDirectorThread => thread !== null)
        .slice(0, Math.max(0, CONTINUITY_DIRECTOR_LIMITS.openThreads - preservedThreads.length));
      const preservedBeats = state.beats.filter((beat) => beat.source === "user" || beat.status !== "proposed");
      const generatedBeats = command.beats
        .slice(0, CONTINUITY_DIRECTOR_LIMITS.proposedBeatsPerRefresh)
        .map((text, index) => makeBeat(text, preservedBeats.length + index, now, makeId))
        .filter((beat): beat is ContinuityDirectorBeat => beat !== null)
        .slice(0, Math.max(0, CONTINUITY_DIRECTOR_LIMITS.retainedBeats - preservedBeats.length));
      const arcInput = command.arc;
      const shouldReplaceArc = arcInput !== undefined && state.currentArc?.source !== "user";
      next = {
        ...state,
        currentArc: shouldReplaceArc
          ? arcInput === null
            ? null
            : makeArc(arcInput ?? "", now, makeId)
          : state.currentArc,
        openThreads: [...preservedThreads, ...generatedThreads],
        beats: reindex([...preservedBeats, ...generatedBeats]),
        sourceSnapshot: command.sourceSnapshot === undefined ? state.sourceSnapshot : command.sourceSnapshot,
      };
      break;
    }
  }

  if (next === state) return state;
  return { ...next, revision: state.revision + 1, updatedAt: now };
}
