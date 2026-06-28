import type { LlmGateway, LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import type { LorebookEntry } from "../../../contracts/types/lorebook";
import { parseJsonArray, parseJsonObject } from "../../../core/json";
import { loadLorebookEntriesForActivationBatch } from "../../../generation/active-lorebook-scanner";
import { boolish } from "../../../generation/runtime-records";
import type { BaseLLMProvider, ChatMessage } from "../../../generation-core/llm/base-provider.js";
import { extractLeadingThinkingBlocks } from "../../../generation-core/llm/inline-thinking";
import { resolveActiveLorebookScopeReason } from "../../../generation-core/lorebooks/active-lorebook-scope";
import { lorebookEntryPassesContextFilters } from "../../../generation-core/lorebooks/keyword-scanner";
import { readString as stringValue } from "../../../shared/value-readers";

// Types

/** A single time block in a character's daily schedule */
interface ScheduleBlock {
  /** Hour range, e.g. "06:00-08:00" */
  time: string;
  /** What the character is doing */
  activity: string;
  /** Derived status for this block */
  status: "online" | "idle" | "dnd" | "offline";
}

/** One day of a character's schedule */
type DaySchedule = ScheduleBlock[];

/** Full weekly schedule for a character */
export interface WeekSchedule {
  /** ISO date string of the Monday this schedule starts */
  weekStart: string;
  /** Schedules keyed by day name */
  days: Record<string, DaySchedule>;
  /** How many minutes of user inactivity before this character messages unprompted (0 = never) */
  inactivityThresholdMinutes: number;
  /** Optional exact response delay in minutes while idle */
  idleResponseDelayMinutes?: number;
  /** Optional exact response delay in minutes while busy / DND */
  dndResponseDelayMinutes?: number;
  /** How chatty the character is; affects autonomous messaging frequency (0-100) */
  talkativeness: number;
}

/** All character schedules stored in chat metadata */
interface CharacterSchedules {
  [characterId: string]: WeekSchedule;
}

export type RoutineBusyAvailability = "available" | "delayed" | "busy" | "unavailable";
export type RoutineSocialEnergyLevel = "low" | "medium" | "high";

export interface ConversationRoutineBusyPeriod {
  when: string;
  summary: string;
  availability: RoutineBusyAvailability;
}

export interface ConversationRoutineSocialEnergy {
  level: RoutineSocialEnergyLevel;
  reason: string;
}

export interface ConversationRoutine {
  weekStart: string;
  generatedAt: string;
  sleep: string;
  busy: ConversationRoutineBusyPeriod[];
  freeish: string[];
  replyStyle: string;
  checkInStyle: string;
  socialEnergy: ConversationRoutineSocialEnergy;
  inactivityThresholdMinutes: number;
  idleResponseDelayMinutes?: number;
  dndResponseDelayMinutes?: number;
  talkativeness: number;
}

interface CharacterRoutines {
  [characterId: string]: ConversationRoutine;
}

type ConversationAvailabilityProfile = WeekSchedule | ConversationRoutine;

type JsonRecord = Record<string, unknown>;

interface ScheduleLorebookContextSource {
  lorebooks: JsonRecord[];
  entriesByLorebookId: Map<string, LorebookEntry[]>;
}

export interface GenerateConversationSchedulesInput {
  chatId: string;
  forceRefresh?: boolean;
  characterIds?: string[];
  scheduleGenerationPreferences?: string;
}

export interface GenerateConversationSchedulesResult {
  results: Record<string, { status: string; schedule?: WeekSchedule; routine?: ConversationRoutine }>;
  schedules: CharacterSchedules;
  routines: CharacterRoutines;
}

// Constants

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SCHEDULE_CONTINUITY_MAX_CHARS = 6000;
const SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS = 6000;
const SCHEDULE_LOREBOOK_ENTRY_MAX_CHARS = 1200;

const STATUS_KEYWORDS: Record<string, "online" | "idle" | "dnd" | "offline"> = {
  sleep: "offline",
  sleeping: "offline",
  nap: "offline",
  napping: "offline",
  rest: "offline",
  resting: "offline",
  work: "dnd",
  working: "dnd",
  class: "dnd",
  classes: "dnd",
  school: "dnd",
  studying: "dnd",
  study: "dnd",
  meeting: "dnd",
  training: "dnd",
  exercise: "dnd",
  gym: "dnd",
  busy: "dnd",
  commute: "idle",
  commuting: "idle",
  driving: "idle",
  travel: "idle",
  traveling: "idle",
  shower: "idle",
  showering: "idle",
  cooking: "idle",
  eating: "idle",
  meal: "idle",
};

export async function generateConversationSchedules(
  capabilities: { storage: StorageGateway; llm: LlmGateway },
  input: GenerateConversationSchedulesInput,
): Promise<GenerateConversationSchedulesResult> {
  const chat = await capabilities.storage.get<JsonRecord>("chats", input.chatId);
  if (!chat) throw new Error("Chat not found");
  if (chat.mode !== "conversation") throw new Error("Not a conversation chat");

  const connection = await resolveScheduleConnection(capabilities.storage, stringValue(chat.connectionId));
  const connectionId = stringValue(connection.id);
  if (!connectionId) throw new Error("No connection configured");

  const meta = parseJsonObject(chat.metadata);
  const existingSchedules = hasSchedules(meta.characterSchedules) ? meta.characterSchedules : {};
  const existingRoutines = hasRoutines(meta.characterRoutines) ? normalizeCharacterRoutines(meta.characterRoutines) : {};
  const characterIds = input.characterIds?.length
    ? input.characterIds
    : parseJsonArray<string>(chat.characterIds).filter(Boolean);
  if (characterIds.length === 0) throw new Error("No conversation characters are selected");
  const provider = createScheduleProvider(capabilities.llm, connectionId, numberOrNull(connection.maxTokensOverride));
  const model = stringValue(connection.model);
  const mondayStr = getMonday().toISOString();
  const generatedAt = new Date().toISOString();
  const userSchedulePreferences =
    typeof input.scheduleGenerationPreferences === "string" ? input.scheduleGenerationPreferences.trim() : "";

  const newSchedules: CharacterSchedules = { ...existingSchedules };
  const newRoutines: CharacterRoutines = { ...existingRoutines };
  const results: GenerateConversationSchedulesResult["results"] = {};
  let otherChatSchedules: Map<string, WeekSchedule> | null = null;
  const getOtherChatSchedules = async () => {
    if (otherChatSchedules) return otherChatSchedules;
    otherChatSchedules = await loadOtherConversationSchedules(capabilities.storage, input.chatId);
    return otherChatSchedules;
  };
  let otherChatRoutines: Map<string, ConversationRoutine> | null = null;
  const getOtherChatRoutines = async () => {
    if (otherChatRoutines) return otherChatRoutines;
    otherChatRoutines = await loadOtherConversationRoutines(capabilities.storage, input.chatId);
    return otherChatRoutines;
  };
  let scheduleLorebookContextSource: Promise<ScheduleLorebookContextSource> | null = null;
  const getScheduleLorebookContextSource = () => {
    scheduleLorebookContextSource ??= loadScheduleLorebookContextSource(capabilities.storage);
    return scheduleLorebookContextSource;
  };

  for (const characterId of characterIds) {
    const existingRoutine = newRoutines[characterId];
    const existingSchedule = newSchedules[characterId];
    if (existingRoutine && !input.forceRefresh && !scheduleNeedsRefresh(existingRoutine)) {
      results[characterId] = { status: "fresh", routine: existingRoutine };
      continue;
    }
    if (existingSchedule && !existingRoutine && !input.forceRefresh && !scheduleNeedsRefresh(existingSchedule)) {
      results[characterId] = { status: "fresh_legacy", schedule: existingSchedule };
      continue;
    }

    if (!input.forceRefresh) {
      const sharedRoutine = (await getOtherChatRoutines()).get(characterId);
      if (sharedRoutine) {
        const mergedShared = preserveRoutineTimingSettings(sharedRoutine, existingRoutine ?? existingSchedule);
        newRoutines[characterId] = mergedShared;
        await updateCharacterConversationStatus(capabilities.storage, characterId, mergedShared);
        results[characterId] = { status: "shared", routine: mergedShared };
        continue;
      }
      const sharedSchedule = (await getOtherChatSchedules()).get(characterId);
      if (sharedSchedule) {
        const mergedShared = preserveTimingSettings(sharedSchedule, existingSchedule);
        newSchedules[characterId] = mergedShared;
        await updateCharacterConversationStatus(capabilities.storage, characterId, mergedShared);
        results[characterId] = { status: "shared_legacy", schedule: mergedShared };
        continue;
      }
    }

    const character = await capabilities.storage.get<JsonRecord>("characters", characterId);
    if (!character) {
      results[characterId] = { status: "not_found" };
      continue;
    }
    const characterData = parseJsonObject(character.data);
    if (parseJsonObject(characterData.extensions).isBuiltInAssistant === true) {
      results[characterId] = { status: "skipped_assistant" };
      continue;
    }

    try {
      const recentContinuityContext = existingRoutine
        ? buildRoutineContinuityContext(existingRoutine)
        : existingSchedule
          ? buildScheduleContinuityContext({ meta, characterData, existingSchedule })
          : undefined;
      const scheduleLorebookContext = await buildScheduleLorebookContext(
        await getScheduleLorebookContextSource(),
        chat,
        meta,
        character,
        characterData,
      );
      const generated = await generateCharacterRoutine(
        provider,
        model,
        stringValue(characterData.name) || "Character",
        stringValue(characterData.description),
        stringValue(characterData.personality),
        userSchedulePreferences,
        recentContinuityContext,
        scheduleLorebookContext,
      );
      if (generated.routine) {
        const fullRoutine = preserveRoutineTimingSettings(
          { ...generated.routine, weekStart: mondayStr, generatedAt },
          existingRoutine ?? existingSchedule,
        );
        newRoutines[characterId] = fullRoutine;
        delete newSchedules[characterId];
        await updateCharacterConversationStatus(
          capabilities.storage,
          characterId,
          fullRoutine,
          character,
          characterData,
        );
        results[characterId] = { status: "generated", routine: fullRoutine };
      } else if (generated.schedule) {
        const fullSchedule = preserveTimingSettings({ ...generated.schedule, weekStart: mondayStr }, existingSchedule);
        newSchedules[characterId] = fullSchedule;
        await updateCharacterConversationStatus(
          capabilities.storage,
          characterId,
          fullSchedule,
          character,
          characterData,
        );
        results[characterId] = { status: "generated_legacy", schedule: fullSchedule };
      } else {
        throw new Error("Routine generation returned no usable routine");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Routine generation failed";
      results[characterId] = { status: `error: ${message}` };
    }
  }

  const hasRequestedRoutine = characterIds.some((characterId) => !!newRoutines[characterId] || !!newSchedules[characterId]);
  if (!hasRequestedRoutine) {
    const failures = Object.values(results)
      .map((result) => result.status)
      .filter((status) => status.startsWith("error: "));
    throw new Error(
      failures[0]?.replace(/^error:\s*/, "") || "No usable routines were generated for this conversation",
    );
  }

  if (Object.keys(newRoutines).length > 0 || Object.keys(newSchedules).length > 0) {
    const freshChat = (await capabilities.storage.get<JsonRecord>("chats", input.chatId)) ?? chat;
    const freshMeta = parseJsonObject(freshChat.metadata);
    const nextMeta: JsonRecord = {
      ...freshMeta,
      conversationSchedulesEnabled: true,
      characterRoutines: newRoutines,
      scheduleWeekStart: mondayStr,
    };
    if (Object.keys(newSchedules).length > 0) {
      nextMeta.characterSchedules = newSchedules;
    } else {
      delete nextMeta.characterSchedules;
    }
    await capabilities.storage.patchChatMetadata(input.chatId, nextMeta);
    await syncGeneratedAvailabilityToOtherChats(
      capabilities.storage,
      input.chatId,
      characterIds,
      results,
      newRoutines,
      newSchedules,
    );
  }

  return { results, schedules: newSchedules, routines: newRoutines };
}
// Schedule Generation

/**
 * Generate a weekly schedule for a character using the LLM.
 */
async function generateCharacterRoutine(
  provider: BaseLLMProvider,
  model: string,
  characterName: string,
  characterDescription: string,
  characterPersonality: string,
  userSchedulePreferences?: string,
  recentContinuityContext?: string,
  scheduleLorebookContext?: string,
): Promise<{ routine?: Omit<ConversationRoutine, "weekStart" | "generatedAt">; schedule?: Omit<WeekSchedule, "weekStart">; raw: string }> {
  const systemPrompt = [
    `You are a fuzzy conversation routine generator. Create an organic routine profile for a character based on their personality and description.`,
    `The routine should feel like how a person would describe their life, not like a calendar export.`,
    ``,
    `Character: ${characterName}`,
    `Description: ${characterDescription}`,
    `Personality: ${characterPersonality}`,
    ``,
    ...(recentContinuityContext?.trim()
      ? [
          `Recent continuity:`,
          `Use the following recent memories, summaries, and previous routine to update the character's durable habits.`,
          `If recent events changed work, school, health, relationships, location, obligations, sleep, or priorities, reflect that in the routine.`,
          `If continuity does not imply a durable habit change, preserve the established lifestyle.`,
          `<recent_continuity>`,
          recentContinuityContext.trim(),
          `</recent_continuity>`,
          ``,
        ]
      : []),
    ...(scheduleLorebookContext?.trim()
      ? [
          `Routine lorebook context:`,
          `The following lorebook facts are already active for this chat or character.`,
          `Use them only when they imply durable routine details such as work, school, location, commute, obligations, sleep patterns, culture, or recurring responsibilities.`,
          `Do not copy irrelevant lore into the routine just because it is listed here.`,
          `<routine_lorebook_context>`,
          scheduleLorebookContext.trim(),
          `</routine_lorebook_context>`,
          ``,
        ]
      : []),
    ...(userSchedulePreferences?.trim()
      ? [
          `User preferences:`,
          `The person using this app has provided the following routine guidance.`,
          `Honor these preferences even when they override typical patterns for this character:`,
          userSchedulePreferences.trim(),
          ``,
        ]
      : []),
    `Create a fuzzy routine, not a strict timetable. Do not create a calendar, hourly plan, or exact Monday-through-Sunday block grid.`,
    `Use phrases like "weekday afternoons", "around dinner", "late at night", "most mornings", and "after class".`,
    `Exact clock times are allowed only inside natural prose when the character concept genuinely calls for them; they must not be required for interpretation.`,
    ``,
    `Also assess the character's talkativeness on a scale of 0-100:`,
    `- 0-20: Very introverted, rarely initiates conversation`,
    `- 21-40: Quiet, only messages when they have something to say`,
    `- 41-60: Average, checks in now and then`,
    `- 61-80: Social, likes to chat frequently`,
    `- 81-100: Very chatty, always wants to talk`,
    ``,
    `Estimate how long (in minutes) this character would wait before messaging someone who hasn't replied:`,
    `- Very patient characters: 180-360 minutes`,
    `- Average characters: 60-180 minutes`,
    `- Impatient/chatty characters: 15-60 minutes`,
    ``,
    `RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no code blocks, just raw JSON).`,
    `{`,
    `  "talkativeness": 65,`,
    `  "inactivityThresholdMinutes": 45,`,
    `  "sleep": "Usually sleeps late night to mid-morning.",`,
    `  "busy": [`,
    `    { "when": "weekday late mornings and afternoons", "summary": "classes", "availability": "busy" }`,
    `  ],`,
    `  "freeish": ["evenings after dinner", "slow weekend mornings"],`,
    `  "replyStyle": "Fast when relaxed, slower when busy or in class.",`,
    `  "checkInStyle": "Likes texting at night when things are quiet.",`,
    `  "socialEnergy": { "level": "medium", "reason": "Warm but focused." }`,
    `}`,
    `Use availability values exactly: "available", "delayed", "busy", or "unavailable".`,
    `Keep every field short and readable.`,
  ].join("\n");

  const scheduleMaxTokens = provider.maxTokensOverrideValue ?? 4096;
  const result = await provider.chatComplete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Generate the fuzzy conversation routine now." },
    ],
    { model, temperature: 0.85, maxTokens: scheduleMaxTokens },
  );

  const content = result.content ?? "";
  const parsed = parseAvailabilityGenerationResponse(content);
  return { ...parsed, raw: content };
}

function parseAvailabilityGenerationResponse(
  content: string,
): { routine?: Omit<ConversationRoutine, "weekStart" | "generatedAt">; schedule?: Omit<WeekSchedule, "weekStart"> } {
  const data = parseGeneratedJson(content);
  const record = parseJsonObject(data);
  if (record.days || parseJsonObject(record.schedule).days || parseJsonObject(record.weeklySchedule).days) {
    return { schedule: parseScheduleResponse(content) };
  }
  return { routine: parseRoutineResponse(content) };
}
function parseGeneratedJson(content: string): unknown {
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1]!.trim();
  const braceStart = jsonStr.indexOf("{");
  const braceEnd = jsonStr.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1) jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
  jsonStr = repairGeneratedJson(jsonStr);
  try {
    return JSON.parse(jsonStr);
  } catch (firstError) {
    const repairedLines = jsonStr.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^[{}[\],]/.test(trimmed)) return true;
      if (/^"/.test(trimmed)) return true;
      if (/^\d/.test(trimmed)) return true;
      if (/^[}\]]/.test(trimmed)) return true;
      return false;
    });
    const repairedStr = repairedLines.join("\n").replace(/,\s*([\]}])/g, "$1");
    try {
      return JSON.parse(repairedStr);
    } catch {
      throw firstError;
    }
  }
}

function repairGeneratedJson(value: string): string {
  return value
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/\.{3,}[^"}\]\n]*/g, "")
    .replace(/\n\s*\n/g, "\n");
}

function parseRoutineResponse(content: string): Omit<ConversationRoutine, "weekStart" | "generatedAt"> {
  const data = normalizeRoutineData(parseGeneratedJson(content));
  const routine = normalizeConversationRoutine(data, { requireGeneratedAt: false, requireWeekStart: false });
  if (!routine) throw new Error("Routine response did not include enough fuzzy routine details");
  const { weekStart: _weekStart, generatedAt: _generatedAt, ...withoutDates } = routine;
  return withoutDates;
}

function normalizeRoutineData(value: unknown): unknown {
  const record = parseJsonObject(value);
  const nested = parseJsonObject(record.routine);
  if (hasRoutineSignal(nested) && !hasRoutineSignal(record)) return nested;
  const conversationRoutine = parseJsonObject(record.conversationRoutine);
  if (hasRoutineSignal(conversationRoutine) && !hasRoutineSignal(record)) return conversationRoutine;
  return record;
}

function hasRoutineSignal(value: JsonRecord): boolean {
  return (
    !!stringValue(value.sleep).trim() ||
    Array.isArray(value.busy) ||
    Array.isArray(value.freeish) ||
    !!stringValue(value.replyStyle).trim() ||
    !!stringValue(value.checkInStyle).trim()
  );
}

function normalizeConversationRoutine(
  value: unknown,
  opts: { requireGeneratedAt?: boolean; requireWeekStart?: boolean } = {},
): ConversationRoutine | null {
  const record = parseJsonObject(value);
  const weekStart = stringValue(record.weekStart).trim();
  const generatedAt = stringValue(record.generatedAt).trim();
  if (opts.requireWeekStart !== false && !weekStart) return null;
  if (opts.requireGeneratedAt !== false && !generatedAt) return null;

  const sleep = stringValue(record.sleep).trim();
  const busy = normalizeRoutineBusyPeriods(record.busy);
  const freeish = normalizeRoutineTextList(record.freeish);
  const replyStyle = stringValue(record.replyStyle).trim();
  const checkInStyle = stringValue(record.checkInStyle).trim();
  const socialEnergy = normalizeRoutineSocialEnergy(record.socialEnergy);
  const hasReadableRoutine =
    !!sleep || busy.length > 0 || freeish.length > 0 || !!replyStyle || !!checkInStyle || !!socialEnergy.reason;
  if (!hasReadableRoutine) return null;

  return {
    weekStart,
    generatedAt,
    sleep,
    busy,
    freeish,
    replyStyle,
    checkInStyle,
    socialEnergy,
    inactivityThresholdMinutes: Math.max(15, Math.min(360, numberOrNull(record.inactivityThresholdMinutes) ?? 120)),
    talkativeness: Math.max(0, Math.min(100, numberOrNull(record.talkativeness) ?? 50)),
  };
}

function normalizeRoutineTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringValue(item).trim()).filter(Boolean);
  const single = stringValue(value).trim();
  return single ? [single] : [];
}

function normalizeRoutineBusyPeriods(value: unknown): ConversationRoutineBusyPeriod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ConversationRoutineBusyPeriod[] => {
    if (typeof item === "string") {
      const summary = item.trim();
      return summary ? [{ when: summary, summary, availability: "busy" }] : [];
    }
    const record = parseJsonObject(item);
    const when = stringValue(record.when).trim();
    const summary = stringValue(record.summary).trim() || stringValue(record.activity).trim() || when;
    if (!when && !summary) return [];
    return [
      {
        when: when || summary,
        summary,
        availability: routineAvailability(record.availability) ?? "busy",
      },
    ];
  });
}

function normalizeRoutineSocialEnergy(value: unknown): ConversationRoutineSocialEnergy {
  const record = parseJsonObject(value);
  const rawLevel = stringValue(record.level).trim().toLowerCase();
  const level: RoutineSocialEnergyLevel = rawLevel === "low" || rawLevel === "high" ? rawLevel : "medium";
  return { level, reason: stringValue(record.reason).trim() };
}

function routineAvailability(value: unknown): RoutineBusyAvailability | null {
  const normalized = stringValue(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "available":
    case "free":
      return "available";
    case "delayed":
    case "semi_available":
    case "idle":
    case "away":
      return "delayed";
    case "busy":
    case "focused":
    case "dnd":
    case "do_not_disturb":
      return "busy";
    case "unavailable":
    case "offline":
    case "asleep":
    case "sleeping":
      return "unavailable";
    default:
      return null;
  }
}
/**
 * Parse the LLM's schedule response into a structured format.
 */
function parseScheduleResponse(content: string): Omit<WeekSchedule, "weekStart"> {
  // Try to extract JSON from response (handle markdown code blocks)
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1]!.trim();

  // Try to find raw JSON object
  const braceStart = jsonStr.indexOf("{");
  const braceEnd = jsonStr.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1) {
    jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
  }

  // Repair common LLM JSON issues: trailing commas, comments, ellipsis, unquoted keys
  jsonStr = jsonStr
    .replace(/\/\/[^\n]*/g, "") // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove multi-line comments
    .replace(/,\s*([\]}])/g, "$1") // remove trailing commas before ] or }
    .replace(/\.{3,}[^"}\]\n]*/g, "") // remove ...etc / ... continuations (not inside strings)
    .replace(/\n\s*\n/g, "\n"); // collapse blank lines left by removals

  type RawScheduleData = {
    talkativeness?: number;
    inactivityThresholdMinutes?: number;
    days?: Record<string, Array<{ time: string; activity: string; status?: string; availability?: string }>>;
    schedule?: unknown;
    weeklySchedule?: unknown;
  };

  let data: RawScheduleData;

  try {
    data = normalizeScheduleData(JSON.parse(jsonStr));
  } catch (firstError) {
    // Second pass: more aggressive repair: remove any lines that are not valid JSON structure
    // This catches things like "// ..." or bare text the LLM added inside the JSON
    const repairedLines = jsonStr.split("\n").filter((line) => {
      const trimmed = line.trim();
      // Keep lines that look like JSON structure (braces, brackets, key-value pairs, commas)
      if (!trimmed) return false;
      if (/^[{}[\],]/.test(trimmed)) return true;
      if (/^"/.test(trimmed)) return true;
      if (/^\d/.test(trimmed)) return true;
      if (/^[}\]]/.test(trimmed)) return true;
      return false;
    });
    const repairedStr = repairedLines.join("\n").replace(/,\s*([\]}])/g, "$1");
    try {
      data = normalizeScheduleData(JSON.parse(repairedStr));
    } catch {
      // If still failing, throw the original error with context
      throw firstError;
    }
  }

  const VALID_STATUSES = new Set(["online", "idle", "dnd", "offline"] as const);
  type ValidStatus = "online" | "idle" | "dnd" | "offline";
  const days: Record<string, DaySchedule> = {};
  for (const day of DAYS) {
    const dayData = getDaySchedule(data.days, day);
    days[day] = dayData.map((block) => {
      const hasAvailability = block.availability !== undefined && block.availability !== null;
      const availabilityStatus = statusFromAvailabilityLabel(block.availability);
      const legacyStatus =
        block.status && VALID_STATUSES.has(block.status as ValidStatus) ? (block.status as ValidStatus) : null;
      if (hasAvailability) {
        if (!availabilityStatus) {
          throw new Error(`Schedule block has unsupported availability for ${day} ${block.time}`);
        }
        if (legacyStatus && availabilityStatus !== legacyStatus) {
          throw new Error(`Schedule block availability/status mismatch for ${day} ${block.time}`);
        }
        return {
          time: block.time,
          activity: block.activity,
          status: availabilityStatus,
        };
      }
      return {
        time: block.time,
        activity: block.activity,
        status: legacyStatus ?? inferStatusFromActivity(block.activity),
      };
    });
  }
  return {
    days,
    talkativeness: Math.max(0, Math.min(100, data.talkativeness ?? 50)),
    inactivityThresholdMinutes: Math.max(15, Math.min(360, data.inactivityThresholdMinutes ?? 120)),
  };
}

function statusFromAvailabilityLabel(value: unknown): "online" | "idle" | "dnd" | "offline" | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "available":
    case "free":
    case "online":
      return "online";
    case "delayed":
    case "semi_available":
    case "semiavailable":
    case "away":
    case "idle":
      return "idle";
    case "busy":
    case "focused":
    case "do_not_disturb":
    case "dnd":
      return "dnd";
    case "unavailable":
    case "offline":
    case "asleep":
    case "sleeping":
      return "offline";
    default:
      return null;
  }
}
/**
 * Infer a conversation status from an activity description.
 */
function inferStatusFromActivity(activity: string): "online" | "idle" | "dnd" | "offline" {
  const lower = activity.toLowerCase();
  for (const [keyword, status] of Object.entries(STATUS_KEYWORDS)) {
    if (lower.includes(keyword)) return status;
  }
  // Default: if it's a leisure/free activity, the character is online
  return "online";
}

// Status Derivation

/**
 * Get the current status and activity for a character based on their schedule.
 */
function scheduleDayIndex(now: Date): number {
  return (now.getDay() + 6) % 7;
}

function scheduleDayName(now: Date): string {
  return DAYS[scheduleDayIndex(now)]!;
}

function previousScheduleDayName(now: Date): string {
  return DAYS[(scheduleDayIndex(now) + DAYS.length - 1) % DAYS.length]!;
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

function scheduleTimeRange(block: ScheduleBlock): { start: number; end: number } | null {
  const [startRaw, endRaw] = block.time.split("-");
  const start = parseScheduleTimeMinutes(startRaw ?? "");
  const end = parseScheduleTimeMinutes(endRaw ?? "");
  if (start === null || end === null) return null;
  return { start, end };
}

function blockContainsMinute(block: ScheduleBlock, minute: number): boolean {
  const range = scheduleTimeRange(block);
  if (!range) return false;
  if (range.start <= range.end) return range.start <= minute && minute < range.end;
  return minute >= range.start;
}

function blockCarriesIntoMinute(block: ScheduleBlock, minute: number): boolean {
  const range = scheduleTimeRange(block);
  if (!range || range.start <= range.end) return false;
  return minute < range.end;
}

export function getCurrentStatus(
  schedule: WeekSchedule,
  now: Date = new Date(),
): { status: "online" | "idle" | "dnd" | "offline"; activity: string } {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayBlock = (schedule.days[scheduleDayName(now)] ?? []).find((block) =>
    blockContainsMinute(block, currentMinutes),
  );
  if (todayBlock) return { status: todayBlock.status, activity: todayBlock.activity };

  const carriedBlock = (schedule.days[previousScheduleDayName(now)] ?? []).find((block) =>
    blockCarriesIntoMinute(block, currentMinutes),
  );
  if (carriedBlock) return { status: carriedBlock.status, activity: carriedBlock.activity };

  return { status: "online", activity: "free time" };
}

export type ConversationAvailability = "available" | "delayed" | "busy" | "unavailable";
export type ConversationAvailabilityDelayKind = "none" | "short" | "long" | "blocked";
export type ConversationAvailabilitySource = "schedule" | "routine" | "fallback";

export interface ConversationAvailabilityDecision {
  source: ConversationAvailabilitySource;
  status: "online" | "idle" | "dnd" | "offline";
  activity: string;
  availability: ConversationAvailability;
  canReplyNow: boolean;
  canMessageFirst: boolean;
  delayKind: ConversationAvailabilityDelayKind;
  reason: string;
}

function isConversationRoutine(value: unknown): value is ConversationRoutine {
  return !!value && typeof value === "object" && !Array.isArray(value) && !("days" in value);
}

function availabilityForStatus(status: "online" | "idle" | "dnd" | "offline"): ConversationAvailability {
  if (status === "online") return "available";
  if (status === "idle") return "delayed";
  if (status === "dnd") return "busy";
  return "unavailable";
}

function delayKindForStatus(status: "online" | "idle" | "dnd" | "offline"): ConversationAvailabilityDelayKind {
  switch (status) {
    case "online":
      return "none";
    case "idle":
      return "short";
    case "dnd":
      return "long";
    case "offline":
      return "blocked";
  }
}

function statusForRoutineAvailability(value: RoutineBusyAvailability): "online" | "idle" | "dnd" | "offline" {
  switch (value) {
    case "available":
      return "online";
    case "delayed":
      return "idle";
    case "busy":
      return "dnd";
    case "unavailable":
      return "offline";
  }
}

function getRoutineCurrentStatus(
  routine: ConversationRoutine,
  now: Date = new Date(),
): { status: "online" | "idle" | "dnd" | "offline"; activity: string } {
  if (routineSleepMatches(routine.sleep, now)) {
    return { status: "offline", activity: routine.sleep };
  }

  const busy = routine.busy.find((entry) => routineTimingMatches(`${entry.when} ${entry.summary}`, now));
  if (busy) {
    return { status: statusForRoutineAvailability(busy.availability), activity: busy.summary || busy.when };
  }

  const freeish = routine.freeish.find((entry) => routineTimingMatches(entry, now));
  if (freeish) return { status: "online", activity: freeish };

  if (routineTimingMatches(routine.checkInStyle, now)) {
    return { status: "online", activity: routine.checkInStyle };
  }

  return { status: "online", activity: "free time" };
}

function routineSleepMatches(value: string, now: Date): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return false;
  const hour = now.getHours();
  if (/late\s*night|night|asleep|sleep/.test(text) && (hour >= 23 || hour <= 4)) return true;
  if (/mid-?morning|sleeps?\s+in|late\s+morning/.test(text) && hour <= 9) return true;
  if (/early\s+morning/.test(text) && hour <= 6) return true;
  return false;
}

function routineTimingMatches(value: string, now: Date): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return false;
  return routineDayMatches(text, now) && routinePeriodMatches(text, now);
}

function routineDayMatches(text: string, now: Date): boolean {
  const day = scheduleDayName(now).toLowerCase();
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  if (/weekdays?|school\s+days?|class\s+days?/.test(text)) return isWeekday;
  if (/weekends?/.test(text)) return !isWeekday;
  const namedDays = DAYS.map((item) => item.toLowerCase()).filter((item) => text.includes(item));
  return namedDays.length === 0 || namedDays.includes(day);
}

function routinePeriodMatches(text: string, now: Date): boolean {
  const hour = now.getHours();
  const checks: Array<[RegExp, boolean]> = [
    [/late\s*night|after\s+midnight/, hour >= 23 || hour <= 4],
    [/night|at\s+night/, hour >= 20 || hour <= 4],
    [/morning/, hour >= 5 && hour <= 11],
    [/lunch|midday|noon/, hour >= 11 && hour <= 13],
    [/afternoon/, hour >= 12 && hour <= 17],
    [/dinner|after\s+dinner|evening/, hour >= 17 && hour <= 22],
    [/after\s+class|after\s+work|gets?\s+home/, hour >= 16 && hour <= 22],
  ];
  return checks.some(([pattern, matches]) => pattern.test(text) && matches);
}

export function getAvailabilityDecision(
  profile: ConversationAvailabilityProfile | null | undefined,
  now: Date = new Date(),
  fallbackActivity = "free time",
): ConversationAvailabilityDecision {
  const current = profile
    ? isConversationRoutine(profile)
      ? getRoutineCurrentStatus(profile, now)
      : getCurrentStatus(profile, now)
    : { status: "online" as const, activity: fallbackActivity };
  const source: ConversationAvailabilitySource = profile ? (isConversationRoutine(profile) ? "routine" : "schedule") : "fallback";
  return {
    source,
    status: current.status,
    activity: current.activity,
    availability: availabilityForStatus(current.status),
    canReplyNow: current.status === "online",
    canMessageFirst: current.status !== "offline",
    delayKind: delayKindForStatus(current.status),
    reason: current.activity,
  };
}
export type ConversationAvailabilityExplanationLabel = "Available" | "Delayed" | "Busy" | "Unavailable";

export interface ConversationAvailabilityExplanation {
  label: ConversationAvailabilityExplanationLabel;
  detail: string;
  message: string;
}

function availabilityExplanationLabelForStatus(
  status: "online" | "idle" | "dnd" | "offline",
): ConversationAvailabilityExplanationLabel {
  switch (status) {
    case "online":
      return "Available";
    case "idle":
      return "Delayed";
    case "dnd":
      return "Busy";
    case "offline":
      return "Unavailable";
  }
}

export function getAvailabilityExplanation(
  decision: Pick<ConversationAvailabilityDecision, "status" | "activity" | "reason">,
): ConversationAvailabilityExplanation {
  const label = availabilityExplanationLabelForStatus(decision.status);
  const rawDetail = decision.reason || decision.activity || "free time";
  const detail = rawDetail.trim().replace(/[.!?]+$/u, "") || "free time";
  return {
    label,
    detail,
    message: `${label}: ${detail}.`,
  };
}
export function getAvailabilityResponseDelay(
  decision: ConversationAvailabilityDecision,
  schedule?: Pick<WeekSchedule, "idleResponseDelayMinutes" | "dndResponseDelayMinutes">,
  urgent = false,
): number {
  return urgent ? getMentionDelay(decision.status) : getBusyDelay(decision.status, schedule);
}

export interface ConversationAvailabilityAutonomousPolicy {
  canMessageFirst: boolean;
  canJoinCharacterExchange: boolean;
  inactivityThresholdMultiplier: number;
}

export function getAvailabilityAutonomousPolicy(
  decision: Pick<ConversationAvailabilityDecision, "status" | "canMessageFirst">,
): ConversationAvailabilityAutonomousPolicy {
  if (!decision.canMessageFirst) {
    return {
      canMessageFirst: false,
      canJoinCharacterExchange: false,
      inactivityThresholdMultiplier: Infinity,
    };
  }
  return {
    canMessageFirst: true,
    canJoinCharacterExchange: decision.status !== "dnd",
    inactivityThresholdMultiplier: decision.status === "dnd" ? 3 : 1,
  };
}

/**
 * Check if a schedule needs regeneration (older than 7 days from current Monday).
 */
export function scheduleNeedsRefresh(schedule: Pick<ConversationAvailabilityProfile, "weekStart">, now: Date = new Date()): boolean {
  const weekStart = new Date(schedule.weekStart);
  const currentMonday = getMonday(now);
  return currentMonday.getTime() > weekStart.getTime();
}

/**
 * Get the Monday of the current week at 00:00.
 */
export function getMonday(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeScheduleData(value: unknown): {
  talkativeness?: number;
  inactivityThresholdMinutes?: number;
  days?: Record<string, Array<{ time: string; activity: string; status?: string; availability?: string }>>;
} {
  const record = parseJsonObject(value);
  const nested = parseJsonObject(record.schedule);
  if (nested.days && !record.days) return nested;
  const weekly = parseJsonObject(record.weeklySchedule);
  if (weekly.days && !record.days) return weekly;
  return record;
}

function getDaySchedule(
  days: Record<string, Array<{ time: string; activity: string; status?: string; availability?: string }>> | undefined,
  day: string,
): Array<{ time: string; activity: string; status?: string; availability?: string }> {
  if (!days) return [];
  const direct = days[day];
  if (Array.isArray(direct)) return direct;
  const match = Object.entries(days).find(([key]) => key.toLowerCase() === day.toLowerCase());
  return Array.isArray(match?.[1]) ? match[1] : [];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringValue(item).trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => stringValue(item).trim()).filter(Boolean) : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function lorebookContextCharacterTags(character: JsonRecord, characterData: JsonRecord): string[] {
  return uniqueStrings([...stringArray(character.tags), ...stringArray(characterData.tags)]);
}

function limitPromptBlockText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 3).trimEnd()}...` : trimmed;
}

function formatScheduleLorebookEntry(entry: LorebookEntry): string {
  const title = entry.name.trim() || "Entry";
  return `### ${title}\n${limitPromptBlockText(entry.content, SCHEDULE_LOREBOOK_ENTRY_MAX_CHARS)}`;
}

function remainingScheduleLoreContextChars(parts: string[], usedChars: number): number {
  return SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS - usedChars - (parts.length > 0 ? 2 : 0);
}

function appendCappedScheduleLoreContext(parts: string[], text: string, usedChars: number): number {
  const trimmed = text.trim();
  if (!trimmed) return usedChars;
  const separatorLength = parts.length > 0 ? 2 : 0;
  const remaining = remainingScheduleLoreContextChars(parts, usedChars);
  if (remaining <= 0) return usedChars;
  if (trimmed.length <= remaining) {
    parts.push(trimmed);
    return usedChars + separatorLength + trimmed.length;
  }
  if (remaining >= 80) {
    parts.push(`${trimmed.slice(0, remaining - 3).trim()}...`);
    return SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS;
  }
  return SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS;
}

async function loadScheduleLorebookContextSource(storage: StorageGateway): Promise<ScheduleLorebookContextSource> {
  const lorebooks = await storage.list<JsonRecord>("lorebooks");
  return {
    lorebooks,
    entriesByLorebookId: await loadLorebookEntriesForActivationBatch(storage, lorebooks),
  };
}

async function buildScheduleLorebookContext(
  source: ScheduleLorebookContextSource,
  chat: JsonRecord,
  meta: JsonRecord,
  character: JsonRecord,
  characterData: JsonRecord,
): Promise<string> {
  const characterId = stringValue(character.id).trim();
  if (!characterId) return "";

  const personaId = stringValue(chat.personaId ?? meta.personaId).trim();
  const scopedLorebooks = source.lorebooks
    .map((book) => ({
      book,
      reason: resolveActiveLorebookScopeReason(book, {
        chat,
        characters: [{ id: characterId }],
        persona: personaId ? { id: personaId } : null,
      }),
    }))
    .filter((item): item is { book: JsonRecord; reason: NonNullable<typeof item.reason> } => !!item.reason);
  if (scopedLorebooks.length === 0) return "";

  const characterTags = lorebookContextCharacterTags(character, characterData);
  const generationTriggers = ["chat", "conversation", "schedule"];
  const parts: string[] = [];
  let usedChars = 0;

  for (const { book, reason } of scopedLorebooks) {
    const lorebookId = stringValue(book.id).trim();
    const entries = (source.entriesByLorebookId.get(lorebookId) ?? [])
      .filter((entry) =>
        lorebookEntryPassesContextFilters(entry, {
          activeCharacterIds: [characterId],
          activeCharacterTags: characterTags,
          generationTriggers,
        }),
      )
      .sort((a, b) => a.order - b.order);
    if (entries.length === 0) continue;

    const formattedEntries = entries.map(formatScheduleLorebookEntry);
    const lorebookName = stringValue(book.name).trim() || reason.lorebookName || lorebookId || "Lorebook";
    const header = `## ${lorebookName}`;
    const remainingBeforeHeader = remainingScheduleLoreContextChars(parts, usedChars);
    if (remainingBeforeHeader <= 0) break;
    if (remainingBeforeHeader < 80) {
      usedChars = SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS;
      break;
    }
    const remainingAfterHeader = remainingBeforeHeader - header.length - 2;
    if (
      remainingAfterHeader < 80 &&
      !formattedEntries.some((entry) => entry.trim().length <= Math.max(0, remainingAfterHeader))
    ) {
      usedChars = SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS;
      break;
    }

    usedChars = appendCappedScheduleLoreContext(parts, header, usedChars);
    if (usedChars >= SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS) break;
    for (const entry of formattedEntries) {
      usedChars = appendCappedScheduleLoreContext(parts, entry, usedChars);
      if (usedChars >= SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS) break;
    }
    if (usedChars >= SCHEDULE_LOREBOOK_CONTEXT_MAX_CHARS) break;
  }

  return parts.join("\n\n");
}

function hasSchedules(value: unknown): value is CharacterSchedules {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasRoutines(value: unknown): value is CharacterRoutines {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function normalizeCharacterRoutines(value: unknown): CharacterRoutines {
  const rawRoutines = parseJsonObject(value);
  const routines: CharacterRoutines = {};
  for (const [characterId, rawRoutine] of Object.entries(rawRoutines)) {
    if (!characterId.trim()) continue;
    const routine = normalizeConversationRoutine(rawRoutine);
    if (routine) routines[characterId] = routine;
  }
  return routines;
}

function areConversationSchedulesEnabled(meta: JsonRecord): boolean {
  return typeof meta.conversationSchedulesEnabled === "boolean"
    ? meta.conversationSchedulesEnabled
    : hasRoutines(meta.characterRoutines) || hasSchedules(meta.characterSchedules);
}

export function getEnabledConversationRoutines(meta: JsonRecord): CharacterRoutines {
  return areConversationSchedulesEnabled(meta) && hasRoutines(meta.characterRoutines)
    ? normalizeCharacterRoutines(meta.characterRoutines)
    : {};
}

export function getEnabledConversationSchedules(meta: JsonRecord): CharacterSchedules {
  return areConversationSchedulesEnabled(meta) && hasSchedules(meta.characterSchedules) ? meta.characterSchedules : {};
}
function createScheduleProvider(
  llm: LlmGateway,
  connectionId: string,
  maxTokensOverrideValue: number | null,
): BaseLLMProvider {
  return {
    maxTokensOverrideValue,
    async chatComplete(messages, options) {
      const requestMessages: LlmMessage[] = messages.map(toLlmMessage);
      const content = await llm.complete(
        requestMessages.length
          ? {
              connectionId,
              model: options.model,
              messages: requestMessages,
              parameters: {
                temperature: options.temperature,
                maxTokens: options.maxTokens,
              },
            }
          : {
              connectionId,
              model: options.model,
              messages: [{ role: "user", content: "" }],
              parameters: {
                temperature: options.temperature,
                maxTokens: options.maxTokens,
              },
            },
      );
      return { content: extractLeadingThinkingBlocks(content).cleanText };
    },
  };
}

function toLlmMessage(message: ChatMessage): LlmMessage {
  const role =
    message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "tool"
      ? message.role
      : "user";
  return { role, content: String(message.content ?? ""), name: message.name };
}

async function resolveScheduleConnection(storage: StorageGateway, chatConnectionId: string): Promise<JsonRecord> {
  const connections = await storage.list<JsonRecord>("connections");
  if (chatConnectionId === "random") {
    const pool = connections.filter((connection) => boolish(connection.useForRandom, false));
    const selected = pool[Math.floor(Math.random() * pool.length)];
    if (!selected) throw new Error("No connections marked for the random pool");
    return selected;
  }
  if (chatConnectionId) {
    const connection = await storage.get<JsonRecord>("connections", chatConnectionId);
    if (!connection) throw new Error("Configured connection not found");
    return connection;
  }
  const selected =
    connections.find((connection) => boolish(connection.isDefault, false) || boolish(connection.default, false)) ??
    connections[0];
  if (!selected) throw new Error("No connection configured");
  return selected;
}

async function loadOtherConversationSchedules(
  storage: StorageGateway,
  currentChatId: string,
): Promise<Map<string, WeekSchedule>> {
  const schedules = new Map<string, WeekSchedule>();
  const allChats = await storage.list<JsonRecord>("chats");
  for (const chat of allChats) {
    if (chat.id === currentChatId || chat.mode !== "conversation") continue;
    const meta = parseJsonObject(chat.metadata);
    if (!areConversationSchedulesEnabled(meta)) continue;
    for (const [characterId, schedule] of Object.entries(getEnabledConversationSchedules(meta))) {
      if (!schedules.has(characterId) && schedule && !scheduleNeedsRefresh(schedule)) {
        schedules.set(characterId, schedule);
      }
    }
  }
  return schedules;
}

async function loadOtherConversationRoutines(
  storage: StorageGateway,
  currentChatId: string,
): Promise<Map<string, ConversationRoutine>> {
  const routines = new Map<string, ConversationRoutine>();
  const allChats = await storage.list<JsonRecord>("chats");
  for (const chat of allChats) {
    if (chat.id === currentChatId || chat.mode !== "conversation") continue;
    const meta = parseJsonObject(chat.metadata);
    if (!areConversationSchedulesEnabled(meta)) continue;
    for (const [characterId, routine] of Object.entries(getEnabledConversationRoutines(meta))) {
      if (!routines.has(characterId) && routine && !scheduleNeedsRefresh(routine)) {
        routines.set(characterId, routine);
      }
    }
  }
  return routines;
}

function preserveTimingSettings(schedule: WeekSchedule, existing?: WeekSchedule): WeekSchedule {
  if (!existing) return schedule;
  const merged: WeekSchedule = {
    ...schedule,
    inactivityThresholdMinutes: existing.inactivityThresholdMinutes,
  };
  if (typeof existing.idleResponseDelayMinutes === "number") {
    merged.idleResponseDelayMinutes = existing.idleResponseDelayMinutes;
  }
  if (typeof existing.dndResponseDelayMinutes === "number") {
    merged.dndResponseDelayMinutes = existing.dndResponseDelayMinutes;
  }
  return merged;
}

function preserveRoutineTimingSettings(
  routine: ConversationRoutine,
  existing?: Pick<ConversationRoutine | WeekSchedule, "inactivityThresholdMinutes" | "idleResponseDelayMinutes" | "dndResponseDelayMinutes">,
): ConversationRoutine {
  if (!existing) return routine;
  const merged: ConversationRoutine = {
    ...routine,
    inactivityThresholdMinutes: existing.inactivityThresholdMinutes,
  };
  if (typeof existing.idleResponseDelayMinutes === "number") {
    merged.idleResponseDelayMinutes = existing.idleResponseDelayMinutes;
  }
  if (typeof existing.dndResponseDelayMinutes === "number") {
    merged.dndResponseDelayMinutes = existing.dndResponseDelayMinutes;
  }
  return merged;
}

async function updateCharacterConversationStatus(
  storage: StorageGateway,
  characterId: string,
  profile: ConversationAvailabilityProfile,
  loadedCharacter?: JsonRecord,
  loadedCharacterData?: JsonRecord,
): Promise<void> {
  const character = loadedCharacter ?? (await storage.get<JsonRecord>("characters", characterId));
  if (!character) return;
  const characterData = loadedCharacterData ?? parseJsonObject(character.data);
  const current = isConversationRoutine(profile) ? getRoutineCurrentStatus(profile) : getCurrentStatus(profile);
  const extensions = {
    ...parseJsonObject(characterData.extensions),
    conversationStatus: current.status,
    conversationActivity: current.activity,
    conversationStatusSource: isConversationRoutine(profile) ? "routine" : "schedule",
  };
  await storage.update("characters", characterId, {
    data: {
      ...characterData,
      extensions,
    },
  });
}

async function syncGeneratedAvailabilityToOtherChats(
  storage: StorageGateway,
  currentChatId: string,
  requestedCharacterIds: string[],
  results: GenerateConversationSchedulesResult["results"],
  newRoutines: CharacterRoutines,
  newSchedules: CharacterSchedules,
): Promise<void> {
  const generatedRoutineIds = requestedCharacterIds.filter((id) => results[id]?.routine && results[id]?.status === "generated");
  const generatedScheduleIds = requestedCharacterIds.filter((id) => results[id]?.schedule && results[id]?.status === "generated_legacy");
  if (generatedRoutineIds.length === 0 && generatedScheduleIds.length === 0) return;

  const allChats = await storage.list<JsonRecord>("chats");
  for (const chat of allChats) {
    const chatId = stringValue(chat.id);
    if (chatId === currentChatId || chat.mode !== "conversation") continue;
    const chatCharacterIds = parseJsonArray<string>(chat.characterIds);
    const routineOverlap = generatedRoutineIds.filter((id) => chatCharacterIds.includes(id));
    const scheduleOverlap = generatedScheduleIds.filter((id) => chatCharacterIds.includes(id));
    if (routineOverlap.length === 0 && scheduleOverlap.length === 0) continue;
    const meta = parseJsonObject(chat.metadata);
    if (!areConversationSchedulesEnabled(meta)) continue;
    const chatRoutines = normalizeCharacterRoutines(meta.characterRoutines);
    const chatSchedules = hasSchedules(meta.characterSchedules) ? { ...meta.characterSchedules } : {};
    let changed = false;

    for (const characterId of routineOverlap) {
      const routine = newRoutines[characterId];
      if (!routine) continue;
      chatRoutines[characterId] = preserveRoutineTimingSettings(routine, chatRoutines[characterId] ?? chatSchedules[characterId]);
      delete chatSchedules[characterId];
      changed = true;
    }
    for (const characterId of scheduleOverlap) {
      const schedule = newSchedules[characterId];
      if (!schedule) continue;
      chatSchedules[characterId] = preserveTimingSettings(schedule, chatSchedules[characterId]);
      changed = true;
    }
    if (changed) {
      const nextMeta: JsonRecord = {
        ...meta,
        conversationSchedulesEnabled: true,
        characterRoutines: chatRoutines,
        scheduleWeekStart: getMonday().toISOString(),
      };
      if (Object.keys(chatSchedules).length > 0) nextMeta.characterSchedules = chatSchedules;
      await storage.patchChatMetadata(chatId, nextMeta);
    }
  }
}

function buildRoutineContinuityContext(routine: ConversationRoutine): string {
  const parts = [
    `Previous fuzzy routine:`,
    `Sleep: ${routine.sleep || "unknown"}`,
    routine.busy.length ? `Busy: ${routine.busy.map((item) => `${item.when}: ${item.summary}`).join("; ")}` : "Busy: none noted",
    routine.freeish.length ? `Free-ish: ${routine.freeish.join("; ")}` : "Free-ish: none noted",
    `Reply style: ${routine.replyStyle || "unknown"}`,
    `Check-in style: ${routine.checkInStyle || "unknown"}`,
    `Social energy: ${routine.socialEnergy.level}${routine.socialEnergy.reason ? `, ${routine.socialEnergy.reason}` : ""}`,
  ];
  return parts.join("\n").slice(0, SCHEDULE_CONTINUITY_MAX_CHARS);
}
type SummaryEntry = { summary: string; keyDetails: string[] };
type CharacterMemoryEntry = { from?: string; summary?: string; createdAt?: string };

function parseDateKeyMs(dateKey: string): number {
  const match = dateKey.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return 0;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function coerceSummaryEntry(value: unknown): SummaryEntry | null {
  if (typeof value === "string") {
    const summary = value.trim();
    return summary ? { summary, keyDetails: [] } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const summary = stringValue(record.summary).trim();
  const keyDetails = parseJsonArray<string>(record.keyDetails).filter((detail) => detail.trim().length > 0);
  return summary || keyDetails.length > 0 ? { summary, keyDetails } : null;
}

function getRecentSummaryEntries(raw: unknown, limit: number): Array<{ key: string; entry: SummaryEntry }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as JsonRecord)
    .map(([key, value]) => ({ key, entry: coerceSummaryEntry(value), time: parseDateKeyMs(key) }))
    .filter((item): item is { key: string; entry: SummaryEntry; time: number } => !!item.entry)
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map(({ key, entry }) => ({ key, entry }));
}

function limitText(value: string, maxChars: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1).trim()}...` : trimmed;
}

function formatSummaryEntry(label: string, entry: SummaryEntry): string[] {
  const lines = [`- ${label}: ${limitText(entry.summary, 700)}`];
  if (entry.keyDetails.length > 0) {
    lines.push(
      `  Key details: ${entry.keyDetails
        .slice(0, 8)
        .map((detail) => limitText(detail, 180))
        .join("; ")}`,
    );
  }
  return lines;
}

function summarizePreviousSchedule(schedule: WeekSchedule): string[] {
  return Object.entries(schedule.days)
    .slice(0, 7)
    .map(([day, blocks]) => {
      const activities = blocks
        .slice(0, 8)
        .map((block) => `${block.time} ${block.activity} (${block.status})`)
        .join("; ");
      return `- ${day}: ${activities}`;
    });
}

function buildScheduleContinuityContext(args: {
  meta: JsonRecord;
  characterData: JsonRecord;
  existingSchedule: WeekSchedule;
}): string {
  const { meta, characterData, existingSchedule } = args;
  const sections: string[] = [];

  sections.push(`<previous_schedule weekStart="${existingSchedule.weekStart}">`);
  sections.push(...summarizePreviousSchedule(existingSchedule));
  sections.push(`</previous_schedule>`);

  const weekSummaries = getRecentSummaryEntries(meta.weekSummaries, 2);
  if (weekSummaries.length > 0) {
    sections.push("", "<recent_week_summaries>");
    for (const { key, entry } of weekSummaries) sections.push(...formatSummaryEntry(`Week of ${key}`, entry));
    sections.push("</recent_week_summaries>");
  }

  const daySummaries = getRecentSummaryEntries(meta.daySummaries, 7);
  if (daySummaries.length > 0) {
    sections.push("", "<recent_day_summaries>");
    for (const { key, entry } of daySummaries) sections.push(...formatSummaryEntry(key, entry));
    sections.push("</recent_day_summaries>");
  }

  const rollingSummary = stringValue(meta.summary).trim();
  if (rollingSummary) {
    sections.push("", "<rolling_chat_summary>", limitText(rollingSummary, 1200), "</rolling_chat_summary>");
  }

  const memories = parseJsonArray<CharacterMemoryEntry>(parseJsonObject(characterData.extensions).characterMemories);
  const previousScheduleStartMs = new Date(existingSchedule.weekStart).getTime();
  const recentMemories = memories
    .filter((memory) => typeof memory.summary === "string" && memory.summary.trim())
    .filter((memory) => {
      if (!Number.isFinite(previousScheduleStartMs) || !memory.createdAt) return true;
      const memoryTime = new Date(memory.createdAt).getTime();
      return !Number.isFinite(memoryTime) || memoryTime >= previousScheduleStartMs;
    })
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 8);
  if (recentMemories.length > 0) {
    sections.push("", "<recent_character_memories>");
    for (const memory of recentMemories) {
      const date = memory.createdAt ? memory.createdAt.slice(0, 10) : "unknown date";
      const from = memory.from ? ` from ${memory.from}` : "";
      sections.push(`- ${date}${from}: ${limitText(memory.summary ?? "", 350)}`);
    }
    sections.push("</recent_character_memories>");
  }

  return sections.join("\n").slice(0, SCHEDULE_CONTINUITY_MAX_CHARS);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Calculate a delay in milliseconds for a "busy" character's response.
 * Returns 0 for online characters, 2-5 minutes for busy characters.
 */
function getConfiguredResponseDelayMinutes(
  status: "online" | "idle" | "dnd" | "offline",
  schedule?: Pick<WeekSchedule, "idleResponseDelayMinutes" | "dndResponseDelayMinutes">,
): number | null {
  const rawValue =
    status === "idle"
      ? schedule?.idleResponseDelayMinutes
      : status === "dnd"
        ? schedule?.dndResponseDelayMinutes
        : null;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return null;
  }
  return Math.max(0, Math.min(120, rawValue));
}

function getConfiguredResponseDelay(
  status: "online" | "idle" | "dnd" | "offline",
  schedule?: Pick<WeekSchedule, "idleResponseDelayMinutes" | "dndResponseDelayMinutes">,
): number {
  const overrideMinutes = getConfiguredResponseDelayMinutes(status, schedule);
  if (overrideMinutes !== null) {
    return overrideMinutes * 60 * 1000;
  }

  switch (status) {
    case "online":
      return 0;
    case "idle":
      return (60 + Math.random() * 120) * 1000; // 1-3 minutes
    case "dnd":
      return (120 + Math.random() * 180) * 1000; // 2-5 minutes
    case "offline":
      return 0; // Shouldn't respond at all when offline
  }
}

export function getBusyDelay(
  status: "online" | "idle" | "dnd" | "offline",
  schedule?: Pick<WeekSchedule, "idleResponseDelayMinutes" | "dndResponseDelayMinutes">,
): number {
  return getConfiguredResponseDelay(status, schedule);
}

export function getMentionDelay(status: "online" | "idle" | "dnd" | "offline"): number {
  switch (status) {
    case "online":
    case "offline":
      return 0;
    case "idle":
      return (5 + Math.random() * 10) * 1000;
    case "dnd":
      return (30 + Math.random() * 60) * 1000;
  }
}
