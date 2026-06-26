import type { ScheduleBlock } from "./chat-settings-metadata";

const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type AvailabilityKey = "available" | "delayed" | "busy" | "unavailable";

interface AvailabilitySchedule {
  weekStart: string;
  days: Record<string, ScheduleBlock[]>;
  inactivityThresholdMinutes: number;
  idleResponseDelayMinutes?: number;
  dndResponseDelayMinutes?: number;
  talkativeness: number;
}

interface AvailabilitySummaryBlock {
  time: string;
  activity: string;
  key: AvailabilityKey;
  label: string;
}

interface DayAvailabilitySummary {
  day: string;
  blocks: AvailabilitySummaryBlock[];
}

interface CharacterAvailabilitySummary {
  current: {
    key: AvailabilityKey;
    label: string;
    activity: string;
    message: string;
  };
  counts: Record<AvailabilityKey, number>;
  activeDays: number;
  totalBlocks: number;
  days: DayAvailabilitySummary[];
}

const AVAILABILITY_LABELS: Record<AvailabilityKey, string> = {
  available: "Available",
  delayed: "Delayed",
  busy: "Busy",
  unavailable: "Unavailable",
};

export function availabilityKeyForStatus(status: ScheduleBlock["status"]): AvailabilityKey {
  switch (status) {
    case "online":
      return "available";
    case "idle":
      return "delayed";
    case "dnd":
      return "busy";
    case "offline":
      return "unavailable";
  }
}

export function availabilityLabelForKey(key: AvailabilityKey): string {
  return AVAILABILITY_LABELS[key];
}

function scheduleDayName(now: Date): string {
  return SCHEDULE_DAYS[(now.getDay() + 6) % 7]!;
}

function parseScheduleTimeMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function blockContainsMinute(block: ScheduleBlock, minute: number): boolean {
  const [startRaw, endRaw] = block.time.split("-");
  const start = parseScheduleTimeMinutes(startRaw ?? "");
  const end = parseScheduleTimeMinutes(endRaw ?? "");
  if (start === null || end === null) return false;
  if (start <= end) return start <= minute && minute < end;
  return minute >= start || minute < end;
}

function currentBlock(schedule: AvailabilitySchedule, now: Date): ScheduleBlock | null {
  const blocks = schedule.days[scheduleDayName(now)] ?? [];
  const minute = now.getHours() * 60 + now.getMinutes();
  return blocks.find((block) => blockContainsMinute(block, minute)) ?? null;
}

function availabilityBlock(block: ScheduleBlock): AvailabilitySummaryBlock {
  const key = availabilityKeyForStatus(block.status);
  return {
    time: block.time,
    activity: block.activity,
    key,
    label: availabilityLabelForKey(key),
  };
}

export function summarizeCharacterAvailability(
  schedule: AvailabilitySchedule,
  now: Date = new Date(),
): CharacterAvailabilitySummary {
  const counts: Record<AvailabilityKey, number> = {
    available: 0,
    delayed: 0,
    busy: 0,
    unavailable: 0,
  };
  const days = SCHEDULE_DAYS.map((day): DayAvailabilitySummary => {
    const blocks = (schedule.days[day] ?? []).map(availabilityBlock);
    for (const block of blocks) counts[block.key] += 1;
    return { day, blocks };
  });
  const blockCount = days.reduce((sum, day) => sum + day.blocks.length, 0);
  const activeDays = days.filter((day) => day.blocks.length > 0).length;
  const current = currentBlock(schedule, now);
  const currentKey = current ? availabilityKeyForStatus(current.status) : "available";
  const currentActivity = current?.activity || "free time";
  const currentLabel = `${availabilityLabelForKey(currentKey)} now`;
  return {
    current: {
      key: currentKey,
      label: currentLabel,
      activity: currentActivity,
      message: `${currentLabel}: ${currentActivity}.`,
    },
    counts,
    activeDays,
    totalBlocks: blockCount,
    days,
  };
}