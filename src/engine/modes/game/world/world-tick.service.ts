import type { GameNpc } from "../../../contracts/types/game";
import type { Journal } from "./journal.service";
import { addMinutes, advanceTime, formatGameTime, type GameTime } from "./time.service";
import type { WeatherState } from "./weather.service";

export type GameWorldTickTrigger =
  | "manual"
  | "session_start"
  | "session_end"
  | "scene_end"
  | "rest"
  | "travel"
  | "time_skip"
  | "day_start";

export type GameWorldTickSkipReason = "disabled" | "duplicate";

export type GameWorldTickWeatherReason = "new_day" | "travel" | "rest";

export interface GameWorldTickNpcRule {
  npcId: string;
  note: string;
}

export interface GameWorldTickNpcUpdate {
  npcId: string;
  npcName: string;
  note: string;
}

export interface GameWorldTickHistoryEntry {
  trigger: GameWorldTickTrigger;
  triggerKey: string;
  ranAt: string;
  recap: string;
  time: GameTime;
  dayChanged: boolean;
  timeChanged: boolean;
  weatherIntent: GameWorldTickWeatherIntent | null;
}

export interface GameWorldTickWeatherIntent {
  refresh: true;
  reason: GameWorldTickWeatherReason;
}

export interface GameWorldTickInput {
  enabled: boolean;
  trigger: GameWorldTickTrigger;
  triggerKey: string;
  previousTriggerKeys: readonly string[];
  time: GameTime;
  weather: WeatherState | null;
  location: string | null;
  journal: Journal;
  npcs: readonly GameNpc[];
  npcRules?: readonly GameWorldTickNpcRule[];
  elapsedMinutes?: number;
  nowIso?: string;
}

export interface GameWorldTickResult {
  changed: boolean;
  skippedReason?: GameWorldTickSkipReason;
  trigger: GameWorldTickTrigger;
  triggerKey: string;
  time: GameTime;
  weather: WeatherState | null;
  weatherIntent: GameWorldTickWeatherIntent | null;
  dayChanged: boolean;
  journal: Journal;
  npcs: readonly GameNpc[];
  npcUpdates: GameWorldTickNpcUpdate[];
  recap: string;
  recapLines: string[];
  nextHistoryEntry: GameWorldTickHistoryEntry | null;
}

const TRIGGER_LABELS: Record<GameWorldTickTrigger, string> = {
  manual: "Manual advance",
  session_start: "Session started",
  session_end: "Session ended",
  scene_end: "Scene ended",
  rest: "Rest",
  travel: "Travel",
  time_skip: "Time skip",
  day_start: "New day",
};

const TRIGGER_TIME_ACTIONS: Partial<Record<GameWorldTickTrigger, string>> = {
  manual: "default",
  scene_end: "default",
  rest: "rest_long",
  travel: "travel",
  time_skip: "default",
};

function normalizeTriggerKey(value: string): string {
  return value.trim();
}

function elapsedMinutesFromInput(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(24 * 60, Math.trunc(value)));
}

function nextTimeForTrigger(time: GameTime, trigger: GameWorldTickTrigger, elapsedMinutes?: number): GameTime {
  const explicitMinutes = elapsedMinutesFromInput(elapsedMinutes);
  if (explicitMinutes != null) return addMinutes(time, explicitMinutes);
  const action = TRIGGER_TIME_ACTIONS[trigger];
  return action ? advanceTime(time, action) : time;
}

function weatherIntentForTrigger(
  trigger: GameWorldTickTrigger,
  dayChanged: boolean,
): GameWorldTickWeatherIntent | null {
  if (dayChanged || trigger === "day_start") return { refresh: true, reason: "new_day" };
  if (trigger === "travel") return { refresh: true, reason: "travel" };
  if (trigger === "rest") return { refresh: true, reason: "rest" };
  return null;
}

function isSessionBoundaryTrigger(trigger: GameWorldTickTrigger): boolean {
  return trigger === "session_start" || trigger === "session_end";
}

function sameTime(left: GameTime, right: GameTime): boolean {
  return left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

function locationLabel(location: string | null): string {
  const trimmed = location?.trim();
  return trimmed || "the current area";
}

function findNpc(npcs: readonly GameNpc[], idOrName: string): GameNpc | null {
  const target = idOrName.trim().toLowerCase();
  if (!target) return null;
  return (
    npcs.find((npc) => npc.id.trim().toLowerCase() === target) ??
    npcs.find((npc) => npc.name.trim().toLowerCase() === target) ??
    null
  );
}

function applyNpcRules(
  npcs: readonly GameNpc[],
  rules: readonly GameWorldTickNpcRule[] | undefined,
): { npcs: readonly GameNpc[]; updates: GameWorldTickNpcUpdate[] } {
  if (!rules?.length) return { npcs, updates: [] };

  let changed = false;
  const updates: GameWorldTickNpcUpdate[] = [];
  const next = npcs.map((npc) => {
    const rule = rules.find((entry) => findNpc([npc], entry.npcId) != null);
    const note = rule?.note.trim();
    if (!rule || !note) return npc;
    const storedNote = `[world_tick] ${note}`;
    updates.push({ npcId: npc.id, npcName: npc.name, note });
    if (npc.notes.includes(storedNote)) return npc;
    changed = true;
    return { ...npc, notes: [...npc.notes, storedNote] };
  });

  return { npcs: changed ? next : npcs, updates };
}

function buildRecapLines(input: {
  trigger: GameWorldTickTrigger;
  time: GameTime;
  dayChanged: boolean;
  timeChanged: boolean;
  weatherIntent: GameWorldTickWeatherIntent | null;
  location: string | null;
  npcUpdates: readonly GameWorldTickNpcUpdate[];
}): string[] {
  const place = locationLabel(input.location);
  const lines = [
    input.timeChanged
      ? `Time advanced to ${formatGameTime(input.time)}.`
      : `World state reviewed at ${formatGameTime(input.time)}.`,
  ];

  if (input.trigger === "session_start") {
    lines.push(`Session started at ${place}.`);
  } else if (input.trigger === "session_end") {
    lines.push(`Session ended at ${place}.`);
  } else if (input.dayChanged || input.trigger === "day_start") {
    lines.push(`A new day begins at ${place}.`);
  }
  if (input.weatherIntent?.reason === "travel") {
    lines.push(`Conditions may shift as travel continues through ${place}.`);
  } else if (input.weatherIntent?.reason === "rest") {
    lines.push(`The weather may settle into a new pattern after the rest at ${place}.`);
  }
  for (const update of input.npcUpdates) {
    lines.push(`${update.npcName}: ${update.note}`);
  }

  return lines;
}

function appendWorldEvent(journal: Journal, nowIso: string, title: string, recap: string): Journal {
  return {
    ...journal,
    entries: [
      ...journal.entries,
      {
        timestamp: nowIso,
        type: "event",
        title,
        content: recap,
      },
    ],
  };
}

export function resolveGameWorldTick(input: GameWorldTickInput): GameWorldTickResult {
  const triggerKey = normalizeTriggerKey(input.triggerKey);
  const base: Omit<GameWorldTickResult, "changed" | "journal" | "npcs" | "npcUpdates" | "recap" | "recapLines"> = {
    trigger: input.trigger,
    triggerKey,
    time: input.time,
    weather: input.weather,
    weatherIntent: null,
    dayChanged: false,
    nextHistoryEntry: null,
  };

  if (!input.enabled) {
    return {
      ...base,
      changed: false,
      skippedReason: "disabled",
      journal: input.journal,
      npcs: input.npcs,
      npcUpdates: [],
      recap: "",
      recapLines: [],
    };
  }

  if (triggerKey && input.previousTriggerKeys.includes(triggerKey)) {
    return {
      ...base,
      changed: false,
      skippedReason: "duplicate",
      journal: input.journal,
      npcs: input.npcs,
      npcUpdates: [],
      recap: "",
      recapLines: [],
    };
  }

  const time = nextTimeForTrigger(input.time, input.trigger, input.elapsedMinutes);
  const dayChanged = time.day > input.time.day;
  const weatherIntent = weatherIntentForTrigger(input.trigger, dayChanged);
  const npcResult = applyNpcRules(input.npcs, input.npcRules);
  const timeChanged = !sameTime(input.time, time);
  const changed =
    timeChanged || weatherIntent != null || npcResult.updates.length > 0 || isSessionBoundaryTrigger(input.trigger);

  if (!changed) {
    return {
      ...base,
      changed: false,
      journal: input.journal,
      npcs: input.npcs,
      npcUpdates: [],
      recap: "",
      recapLines: [],
    };
  }

  const recapLines = buildRecapLines({
    trigger: input.trigger,
    time,
    dayChanged,
    timeChanged,
    weatherIntent,
    location: input.location,
    npcUpdates: npcResult.updates,
  });
  const recap = recapLines.join("\n");
  const nowIso = input.nowIso ?? new Date().toISOString();
  const journal = appendWorldEvent(input.journal, nowIso, `World advanced: ${TRIGGER_LABELS[input.trigger]}`, recap);
  const nextHistoryEntry: GameWorldTickHistoryEntry = {
    trigger: input.trigger,
    triggerKey,
    ranAt: nowIso,
    recap,
    time,
    dayChanged,
    timeChanged,
    weatherIntent,
  };

  return {
    ...base,
    changed: true,
    time,
    weatherIntent,
    dayChanged,
    journal,
    npcs: npcResult.npcs,
    npcUpdates: npcResult.updates,
    recap,
    recapLines,
    nextHistoryEntry,
  };
}
