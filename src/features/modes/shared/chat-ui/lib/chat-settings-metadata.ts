export type ChoiceSelections = Record<string, string | string[]>;
export type TranslationProvider = "ai" | "deeplx" | "deepl" | "google";
export type ScopedRegexModeValue = "disabled" | "exclusive" | "chat";
const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
interface ScheduleBlock {
  time: string;
  activity: string;
  status: "online" | "idle" | "dnd" | "offline";
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

function metadataScheduleBlocks(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScheduleBlock[] => {
    const block = metadataRecord(item);
    const time = metadataString(block.time);
    const activity = metadataString(block.activity);
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
      days[day] = metadataScheduleBlocks(rawDays[day]);
    }
    for (const [day, blocks] of Object.entries(rawDays)) {
      if (!(day in days)) days[day] = metadataScheduleBlocks(blocks);
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
