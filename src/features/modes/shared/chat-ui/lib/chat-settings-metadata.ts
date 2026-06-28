export type ChoiceSelections = Record<string, string | string[]>;
export type TranslationProvider = "ai" | "deeplx" | "deepl" | "google";
export type ScopedRegexModeValue = "disabled" | "exclusive" | "chat";
const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export interface ScheduleBlock {
  time: string;
  activity: string;
  status: "online" | "idle" | "dnd" | "offline";
}

export type RoutineBusyAvailability = "available" | "delayed" | "busy" | "unavailable";
export type RoutineSocialEnergyLevel = "low" | "medium" | "high";

export interface ConversationRoutineBusyPeriod {
  when: string;
  summary: string;
  availability: RoutineBusyAvailability;
}

export interface ConversationRoutine {
  weekStart: string;
  generatedAt: string;
  sleep: string;
  busy: ConversationRoutineBusyPeriod[];
  freeish: string[];
  replyStyle: string;
  checkInStyle: string;
  socialEnergy: {
    level: RoutineSocialEnergyLevel;
    reason: string;
  };
  inactivityThresholdMinutes: number;
  idleResponseDelayMinutes?: number;
  dndResponseDelayMinutes?: number;
  talkativeness: number;
}

type CharacterScheduleMap = Record<
  string,
  {
    weekStart: string;
    days: Record<string, ScheduleBlock[]>;
    inactivityThresholdMinutes: number;
    idleResponseDelayMinutes?: number;
    dndResponseDelayMinutes?: number;
    talkativeness: number;
  }
>;

export type CharacterRoutineMap = Record<string, ConversationRoutine>;

export function metadataString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function metadataNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metadataClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = metadataNumber(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function metadataOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = metadataNumber(value, NaN);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : undefined;
}

function metadataScheduleStatus(value: unknown): ScheduleBlock["status"] {
  return value === "online" || value === "idle" || value === "dnd" || value === "offline" ? value : "online";
}

function metadataRoutineAvailability(value: unknown): RoutineBusyAvailability {
  return value === "available" || value === "delayed" || value === "busy" || value === "unavailable"
    ? value
    : "delayed";
}

function metadataSocialEnergyLevel(value: unknown): RoutineSocialEnergyLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

export function normalizeScheduleBlocks(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScheduleBlock[] => {
    const block = metadataRecord(item);
    const time = metadataString(block.time).trim();
    const activity = metadataString(block.activity).trim();
    if (!time || !activity) return [];
    return [{ time, activity, status: metadataScheduleStatus(block.status) }];
  });
}

export function metadataCharacterSchedules(value: unknown): CharacterScheduleMap {
  const rawSchedules = metadataRecord(value);
  const characterSchedules: CharacterScheduleMap = {};
  for (const [characterId, rawSchedule] of Object.entries(rawSchedules)) {
    if (!characterId.trim()) continue;
    const schedule = metadataRecord(rawSchedule);
    const weekStart = metadataString(schedule.weekStart);
    if (!weekStart) continue;
    const rawDays = metadataRecord(schedule.days);
    const days: Record<string, ScheduleBlock[]> = {};
    for (const day of SCHEDULE_DAYS) {
      days[day] = normalizeScheduleBlocks(rawDays[day]);
    }
    for (const [day, blocks] of Object.entries(rawDays)) {
      if (!(day in days)) days[day] = normalizeScheduleBlocks(blocks);
    }
    characterSchedules[characterId] = {
      weekStart,
      days,
      inactivityThresholdMinutes: metadataClampedNumber(schedule.inactivityThresholdMinutes, 120, 15, 360),
      talkativeness: metadataClampedNumber(schedule.talkativeness, 50, 0, 100),
    };
    const idleResponseDelayMinutes = metadataOptionalNumber(schedule.idleResponseDelayMinutes, 0, 120);
    if (idleResponseDelayMinutes !== undefined) {
      characterSchedules[characterId].idleResponseDelayMinutes = idleResponseDelayMinutes;
    }
    const dndResponseDelayMinutes = metadataOptionalNumber(schedule.dndResponseDelayMinutes, 0, 120);
    if (dndResponseDelayMinutes !== undefined) {
      characterSchedules[characterId].dndResponseDelayMinutes = dndResponseDelayMinutes;
    }
  }
  return characterSchedules;
}

function metadataRoutineBusyPeriods(value: unknown): ConversationRoutineBusyPeriod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ConversationRoutineBusyPeriod[] => {
    const period = metadataRecord(item);
    const when = metadataString(period.when).trim();
    const summary = metadataString(period.summary).trim();
    if (!when || !summary) return [];
    return [{ when, summary, availability: metadataRoutineAvailability(period.availability) }];
  });
}

export function metadataCharacterRoutines(value: unknown): CharacterRoutineMap {
  const rawRoutines = metadataRecord(value);
  const characterRoutines: CharacterRoutineMap = {};
  for (const [characterId, rawRoutine] of Object.entries(rawRoutines)) {
    if (!characterId.trim()) continue;
    const routine = metadataRecord(rawRoutine);
    const weekStart = metadataString(routine.weekStart).trim();
    const generatedAt = metadataString(routine.generatedAt).trim();
    const sleep = metadataString(routine.sleep).trim();
    const busy = metadataRoutineBusyPeriods(routine.busy);
    const freeish = metadataStringArray(routine.freeish).map((item) => item.trim()).filter(Boolean);
    const replyStyle = metadataString(routine.replyStyle).trim();
    const checkInStyle = metadataString(routine.checkInStyle).trim();
    const socialEnergyRaw = metadataRecord(routine.socialEnergy);
    const socialEnergy = {
      level: metadataSocialEnergyLevel(socialEnergyRaw.level),
      reason: metadataString(socialEnergyRaw.reason).trim(),
    };
    const hasRoutineSignal =
      sleep.length > 0 ||
      busy.length > 0 ||
      freeish.length > 0 ||
      replyStyle.length > 0 ||
      checkInStyle.length > 0 ||
      socialEnergy.reason.length > 0;
    if (!weekStart || !generatedAt || !hasRoutineSignal) continue;
    characterRoutines[characterId] = {
      weekStart,
      generatedAt,
      sleep,
      busy,
      freeish,
      replyStyle,
      checkInStyle,
      socialEnergy,
      inactivityThresholdMinutes: metadataClampedNumber(routine.inactivityThresholdMinutes, 120, 15, 360),
      talkativeness: metadataClampedNumber(routine.talkativeness, 50, 0, 100),
    };
    const idleResponseDelayMinutes = metadataOptionalNumber(routine.idleResponseDelayMinutes, 0, 120);
    if (idleResponseDelayMinutes !== undefined) {
      characterRoutines[characterId].idleResponseDelayMinutes = idleResponseDelayMinutes;
    }
    const dndResponseDelayMinutes = metadataOptionalNumber(routine.dndResponseDelayMinutes, 0, 120);
    if (dndResponseDelayMinutes !== undefined) {
      characterRoutines[characterId].dndResponseDelayMinutes = dndResponseDelayMinutes;
    }
  }
  return characterRoutines;
}

export function metadataChoiceSelections(value: unknown): ChoiceSelections {
  const record = metadataRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string | string[]] =>
        typeof entry[1] === "string" || (Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string")),
    ),
  );
}

export function metadataTranslationProvider(value: unknown): TranslationProvider {
  return value === "ai" || value === "deeplx" || value === "deepl" || value === "google" ? value : "google";
}

export function metadataScopedRegexMode(value: unknown): ScopedRegexModeValue {
  return value === "disabled" || value === "exclusive" || value === "chat" ? value : "chat";
}