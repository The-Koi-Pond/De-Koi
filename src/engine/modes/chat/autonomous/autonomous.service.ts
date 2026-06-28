import type { StorageGateway } from "../../../capabilities/storage";
import {
  getAvailabilityAutonomousPolicy,
  getAvailabilityDecision,
  getAvailabilityExplanation,
  getAvailabilityResponseDelay,
  getEnabledConversationRoutines,
  getEnabledConversationSchedules,
  getMonday,
  scheduleNeedsRefresh,
  type ConversationRoutine,
  type WeekSchedule,
} from "../schedules/schedule.service.js";

// Ã¢â€â‚¬Ã¢â€â‚¬ Types Ã¢â€â‚¬Ã¢â€â‚¬

export interface AutonomousCheckResult {
  /** Whether an autonomous message should be triggered */
  shouldTrigger: boolean;
  /** Which character(s) should send a message */
  characterIds: string[];
  /** Why this was triggered */
  reason: "user_inactivity" | "character_exchange" | "none" | "disabled" | "user_dnd" | "scene_active" | "waiting";
  /** How long the user has been inactive (ms) */
  inactivityMs: number;
}

export interface ConversationStatusResult {
  statuses: Record<
    string,
    {
      status: string;
      activity: string;
      schedule?: unknown;
      routine?: unknown;
      availabilityExplanation: ReturnType<typeof getAvailabilityExplanation>;
    }
  >;
  needsRefresh: boolean;
}

export interface BusyDelayResult {
  delayMs: number;
  status: string;
  activity: string;
}

type StoredChat = {
  id?: unknown;
  mode?: unknown;
  characterIds?: unknown;
  metadata?: unknown;
};

type StoredMessage = {
  role?: unknown;
  createdAt?: unknown;
  characterId?: unknown;
};

type UserStatus = "active" | "idle" | "dnd";

const AUTONOMOUS_ACTIVITY_MESSAGE_LIMIT = 80;
const AUTONOMOUS_ACTIVITY_MESSAGE_FIELDS = ["role", "createdAt", "characterId"];

function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function chatCharacterIds(chat: StoredChat): string[] {
  return Array.isArray(chat.characterIds)
    ? chat.characterIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

async function requireChat(storage: StorageGateway, chatId: string): Promise<StoredChat> {
  const chat = await storage.get<StoredChat>("chats", chatId);
  if (!chat) throw new Error("Chat was not found");
  return chat;
}

async function chatMessages(storage: StorageGateway, chatId: string): Promise<StoredMessage[]> {
  const rows = await storage.listChatMessages<unknown>(chatId, {
    limit: AUTONOMOUS_ACTIVITY_MESSAGE_LIMIT,
    fields: AUTONOMOUS_ACTIVITY_MESSAGE_FIELDS,
  });
  return Array.isArray(rows) ? (rows as StoredMessage[]) : [];
}

function characterSchedules(meta: Record<string, unknown>): Record<string, WeekSchedule> {
  return getEnabledConversationSchedules(meta);
}

function characterRoutines(meta: Record<string, unknown>): Record<string, ConversationRoutine> {
  return getEnabledConversationRoutines(meta);
}

async function syncStoredConversationStatus(
  storage: StorageGateway,
  characterId: string,
  status: { status: string; activity: string; availabilityExplanation?: string; source?: "routine" | "schedule" } | null,
): Promise<void> {
  const character = await storage.get<Record<string, unknown>>("characters", characterId);
  if (!character) return;
  const data = metadataRecord(character.data);
  const extensions = metadataRecord(data.extensions);
  const nextExtensions = { ...extensions };
  if (status) {
    nextExtensions.conversationStatus = status.status;
    nextExtensions.conversationActivity = status.activity;
    nextExtensions.conversationStatusSource = status.source ?? "schedule";
    if (status.availabilityExplanation) {
      nextExtensions.conversationAvailabilityExplanation = status.availabilityExplanation;
    } else {
      delete nextExtensions.conversationAvailabilityExplanation;
    }
  } else {
    delete nextExtensions.conversationStatus;
    delete nextExtensions.conversationActivity;
    delete nextExtensions.conversationStatusSource;
    delete nextExtensions.conversationAvailabilityExplanation;
  }
  if (
    nextExtensions.conversationStatus === extensions.conversationStatus &&
    nextExtensions.conversationActivity === extensions.conversationActivity &&
    nextExtensions.conversationStatusSource === extensions.conversationStatusSource &&
    nextExtensions.conversationAvailabilityExplanation === extensions.conversationAvailabilityExplanation
  ) {
    return;
  }
  await storage.update("characters", characterId, {
    data: {
      ...data,
      extensions: nextExtensions,
    },
  });
}
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function characterTalkativeness(character: unknown): number {
  const row = metadataRecord(character);
  const data = metadataRecord(row.data);
  const extensions = metadataRecord(data.extensions);
  const raw = extensions.talkativeness;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return 50;
  return clampPercent(value <= 1 ? value * 100 : value);
}

function schedulelessInactivityThresholdMinutes(talkativeness: number, userStatus: UserStatus): number {
  const chatty = clampPercent(talkativeness) / 100;
  const minMinutes = userStatus === "idle" ? 10 : 30;
  const maxMinutes = userStatus === "idle" ? 180 : 360;
  return Math.round(maxMinutes - (maxMinutes - minMinutes) * chatty);
}

function createSchedulelessAutonomySchedule(talkativeness: number, userStatus: UserStatus): WeekSchedule {
  return {
    weekStart: getMonday().toISOString(),
    days: {},
    inactivityThresholdMinutes: schedulelessInactivityThresholdMinutes(talkativeness, userStatus),
    talkativeness,
  };
}

function stringSet(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
  );
}

export async function getConversationStatus(
  storage: StorageGateway,
  chatId: string,
): Promise<ConversationStatusResult> {
  const chat = await requireChat(storage, chatId);
  const meta = metadataRecord(chat.metadata);
  const routines = characterRoutines(meta);
  const schedules = characterSchedules(meta);
  const statusRoutines: Record<string, ConversationRoutine> = { ...routines };
  const statusSchedules: Record<string, WeekSchedule> = { ...schedules };
  const statuses: ConversationStatusResult["statuses"] = {};
  let needsRefresh = false;
  let inheritedFreshAvailability = false;
  let otherConversationRoutines: Promise<Map<string, ConversationRoutine>> | null = null;
  let otherConversationSchedules: Promise<Map<string, WeekSchedule>> | null = null;

  for (const characterId of chatCharacterIds(chat)) {
    let routine = statusRoutines[characterId];
    let schedule: WeekSchedule | undefined = statusSchedules[characterId];
    if (routine && scheduleNeedsRefresh(routine)) {
      otherConversationRoutines ??= loadFreshConversationRoutines(storage, chatId);
      const inherited = (await otherConversationRoutines).get(characterId);
      if (inherited) {
        routine = inherited;
        statusRoutines[characterId] = inherited;
        delete statusSchedules[characterId];
        schedule = undefined;
        inheritedFreshAvailability = true;
      } else {
        needsRefresh = true;
      }
    } else if (!routine && schedule && scheduleNeedsRefresh(schedule)) {
      otherConversationSchedules ??= loadFreshConversationSchedules(storage, chatId);
      const inherited = (await otherConversationSchedules).get(characterId);
      if (inherited) {
        schedule = inherited;
        statusSchedules[characterId] = inherited;
        inheritedFreshAvailability = true;
      } else {
        needsRefresh = true;
      }
    }

    const profile = routine ?? schedule;
    const availability = getAvailabilityDecision(profile, new Date(), profile ? "scheduled" : "unknown (no schedule)");
    const availabilityExplanation = getAvailabilityExplanation(availability);
    statuses[characterId] = {
      status: availability.status,
      activity: availability.activity,
      schedule,
      routine,
      availabilityExplanation,
    };
    if (profile) {
      await syncStoredConversationStatus(storage, characterId, {
        status: availability.status,
        activity: availability.activity,
        availabilityExplanation: availabilityExplanation.message,
        source: routine ? "routine" : "schedule",
      });
    } else {
      await syncStoredConversationStatus(storage, characterId, null);
    }
  }

  if (inheritedFreshAvailability) {
    const nextMeta: Record<string, unknown> = {
      ...meta,
      conversationSchedulesEnabled: true,
      scheduleWeekStart: getMonday().toISOString(),
    };
    if (Object.keys(statusRoutines).length > 0) nextMeta.characterRoutines = statusRoutines;
    if (Object.keys(statusSchedules).length > 0) nextMeta.characterSchedules = statusSchedules;
    await storage.patchChatMetadata(chatId, nextMeta);
  }

  return { statuses, needsRefresh };
}

async function loadFreshConversationRoutines(
  storage: StorageGateway,
  currentChatId: string,
): Promise<Map<string, ConversationRoutine>> {
  const routines = new Map<string, ConversationRoutine>();
  const chats = await storage.list<StoredChat>("chats");
  for (const chat of chats) {
    if (chat.id === currentChatId || chat.mode !== "conversation") continue;
    const meta = metadataRecord(chat.metadata);
    for (const [characterId, routine] of Object.entries(characterRoutines(meta))) {
      if (!routines.has(characterId) && routine && !scheduleNeedsRefresh(routine)) {
        routines.set(characterId, routine);
      }
    }
  }
  return routines;
}
async function loadFreshConversationSchedules(
  storage: StorageGateway,
  currentChatId: string,
): Promise<Map<string, WeekSchedule>> {
  const schedules = new Map<string, WeekSchedule>();
  const chats = await storage.list<StoredChat>("chats");
  for (const chat of chats) {
    if (chat.id === currentChatId || chat.mode !== "conversation") continue;
    const meta = metadataRecord(chat.metadata);
    for (const [characterId, schedule] of Object.entries(characterSchedules(meta))) {
      if (!schedules.has(characterId) && schedule && !scheduleNeedsRefresh(schedule)) {
        schedules.set(characterId, schedule);
      }
    }
  }
  return schedules;
}

export async function checkConversationAutonomous(
  storage: StorageGateway,
  input: { chatId: string; userStatus?: string; maxFollowups?: number },
): Promise<AutonomousCheckResult> {
  const chat = await requireChat(storage, input.chatId);
  const meta = metadataRecord(chat.metadata);
  const userStatus: UserStatus =
    input.userStatus === "idle" || input.userStatus === "dnd" ? input.userStatus : "active";
  const disabled = meta.autonomousMessages !== true;
  if (disabled) return { shouldTrigger: false, characterIds: [], reason: "disabled", inactivityMs: 0 };
  if (userStatus === "dnd") return { shouldTrigger: false, characterIds: [], reason: "user_dnd", inactivityMs: 0 };
  if (meta.sceneStatus === "active")
    return { shouldTrigger: false, characterIds: [], reason: "scene_active", inactivityMs: 0 };

  const messages = await chatMessages(storage, input.chatId);
  initializeActivityFromMessages(
    input.chatId,
    messages.map((message) => ({
      role: typeof message.role === "string" ? message.role : "message",
      createdAt: typeof message.createdAt === "string" ? message.createdAt : undefined,
      characterId: typeof message.characterId === "string" ? message.characterId : null,
    })),
  );

  const ids = chatCharacterIds(chat);
  const schedules = characterSchedules(meta);
  const routines = characterRoutines(meta);
  const autonomyProfiles: Record<string, WeekSchedule | ConversationRoutine> = { ...schedules, ...routines };
  await Promise.all(
    ids
      .filter((characterId) => !autonomyProfiles[characterId])
      .map(async (characterId) => {
        const character = await storage.get("characters", characterId);
        autonomyProfiles[characterId] = createSchedulelessAutonomySchedule(
          characterTalkativeness(character),
          userStatus,
        );
      }),
  );

  const sceneBusyIds = stringSet(meta.sceneBusyCharIds);
  for (const busyId of sceneBusyIds) {
    delete autonomyProfiles[busyId];
  }

  const scheduled = checkAutonomousMessaging(input.chatId, autonomyProfiles, ids.length > 1, {
    maxFollowups: input.maxFollowups,
  });
  if (scheduled.shouldTrigger) return scheduled;

  if (Object.keys(schedules).length > 0 || Object.keys(routines).length > 0) {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      const onlineIds = ids.filter((characterId) => {
        if (sceneBusyIds.has(characterId)) return false;
        const decision = getAvailabilityDecision(routines[characterId] ?? schedules[characterId] ?? autonomyProfiles[characterId]!);
        return getAvailabilityAutonomousPolicy(decision).canMessageFirst;
      });
      if (onlineIds.length > 0) {
        return {
          shouldTrigger: true,
          characterIds: [onlineIds[0]!],
          reason: "user_inactivity",
          inactivityMs: 0,
        };
      }
    }
  }

  return { shouldTrigger: false, characterIds: [], reason: "waiting", inactivityMs: 0 };
}

export async function getConversationBusyDelay(
  storage: StorageGateway,
  input: { chatId: string; characterId: string },
): Promise<BusyDelayResult> {
  const chat = await requireChat(storage, input.chatId);
  const meta = metadataRecord(chat.metadata);
  const profile = characterRoutines(meta)[input.characterId] ?? characterSchedules(meta)[input.characterId];
  const decision = getAvailabilityDecision(profile ?? null, new Date(), profile ? "scheduled" : "unknown");
  return {
    delayMs: getAvailabilityResponseDelay(decision, profile),
    status: decision.status,
    activity: decision.activity,
  };
}

export async function checkConversationCharacterExchange(
  storage: StorageGateway,
  input: { chatId: string; lastSpeakerCharId: string },
): Promise<AutonomousCheckResult> {
  const chat = await requireChat(storage, input.chatId);
  const meta = metadataRecord(chat.metadata);
  if (meta.characterExchanges !== true) {
    return { shouldTrigger: false, characterIds: [], reason: "disabled", inactivityMs: 0 };
  }
  return checkCharacterExchange(input.chatId, input.lastSpeakerCharId, { ...characterSchedules(meta), ...characterRoutines(meta) });
}

export type AutonomousClientPresenceStatus = "active" | "idle" | "dnd";

/** Auto-reset generationInProgress after this many ms (5 minutes) */
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

interface ChatActivityState {
  /** Timestamp of the last user message */
  lastUserMessageAt: number;
  /** Timestamp of the last assistant message */
  lastAssistantMessageAt: number;
  /** Per-character autonomous message tracking: count sent + timestamp of last autonomous msg */
  autonomousMessages: Map<string, { count: number; lastSentAt: number }>;
  /** Timestamp when generation started, or null if not in progress */
  generationInProgressSince: number | null;
  /** Last status reported by a connected client autonomous poller. */
  clientPresence?: { status: AutonomousClientPresenceStatus; updatedAt: number };
}

// Ã¢â€â‚¬Ã¢â€â‚¬ In-memory activity tracker Ã¢â€â‚¬Ã¢â€â‚¬
// Keyed by chatId. This is intentionally in-memory since it's just timing state.
const activityStates = new Map<string, ChatActivityState>();

/**
 * Record that the user sent a message in a chat.
 */
export function recordUserActivity(chatId: string, opts: { preserveGenerationInProgress?: boolean } = {}): void {
  const now = Date.now();
  const existing = activityStates.get(chatId);
  if (existing) {
    existing.lastUserMessageAt = now;
    existing.autonomousMessages.clear(); // Reset Ã¢â‚¬â€ user is active again
    if (!opts.preserveGenerationInProgress) {
      existing.generationInProgressSince = null;
    }
  } else {
    activityStates.set(chatId, {
      lastUserMessageAt: now,
      lastAssistantMessageAt: 0,
      autonomousMessages: new Map(),
      generationInProgressSince: null,
    });
  }
}

/**
 * Record that an assistant message was sent (either user-triggered or autonomous).
 */
export function recordAssistantActivity(chatId: string, characterId?: string): void {
  const existing = activityStates.get(chatId);
  if (existing) {
    const now = Date.now();
    existing.lastAssistantMessageAt = now;
    if (characterId) {
      const prev = existing.autonomousMessages.get(characterId);
      existing.autonomousMessages.set(characterId, {
        count: (prev?.count ?? 0) + 1,
        lastSentAt: now,
      });
    }
    existing.generationInProgressSince = null;
  }
}

/**
 * Mark that an autonomous generation is in progress for a chat.
 */
export function markGenerationInProgress(chatId: string): number {
  const now = Date.now();
  const state = activityStates.get(chatId);
  if (state) {
    state.generationInProgressSince = now;
  } else {
    activityStates.set(chatId, {
      lastUserMessageAt: 0,
      lastAssistantMessageAt: 0,
      autonomousMessages: new Map(),
      generationInProgressSince: now,
    });
  }
  return now;
}

/**
 * Clear a generation-in-progress marker. If `startedAt` is supplied, only
 * clear the marker that this caller created.
 */
export function clearGenerationInProgress(chatId: string, startedAt?: number): void {
  const state = activityStates.get(chatId);
  if (!state) return;
  if (startedAt != null && state.generationInProgressSince !== startedAt) return;
  state.generationInProgressSince = null;
}

/**
 * Initialize activity state from DB messages if not already tracked in memory.
 * This handles server restarts and fresh page loads Ã¢â‚¬â€ we look at the most recent
 * messages to reconstruct timing state so autonomous messaging can resume.
 */
function initializeActivityFromMessages(
  chatId: string,
  messages: Array<{ role: string; createdAt?: string; characterId?: string | null }>,
): void {
  // Already tracked Ã¢â‚¬â€ don't overwrite
  if (activityStates.has(chatId)) return;
  if (messages.length === 0) return;

  let lastUserAt = 0;
  let lastAssistantAt = 0;

  // Scan messages in reverse to find timestamps efficiently
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const ts = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
    if (msg.role === "user" && !lastUserAt) lastUserAt = ts;
    if (msg.role === "assistant" && !lastAssistantAt) lastAssistantAt = ts;
    if (lastUserAt && lastAssistantAt) break;
  }

  if (!lastUserAt) return; // No user messages Ã¢â‚¬â€ can't initialize

  activityStates.set(chatId, {
    lastUserMessageAt: lastUserAt,
    lastAssistantMessageAt: lastAssistantAt,
    autonomousMessages: new Map(),
    generationInProgressSince: null,
  });
}

export function recordAutonomousClientPresence(
  chatId: string,
  status: AutonomousClientPresenceStatus = "active",
): void {
  const now = Date.now();
  const state = activityStates.get(chatId);
  if (state) {
    state.clientPresence = { status, updatedAt: now };
    return;
  }

  activityStates.set(chatId, {
    lastUserMessageAt: 0,
    lastAssistantMessageAt: 0,
    autonomousMessages: new Map(),
    generationInProgressSince: null,
    clientPresence: { status, updatedAt: now },
  });
}

/**
 * Check whether any character in a chat should send an autonomous message.
 */
function checkAutonomousMessaging(
  chatId: string,
  characterSchedules: Record<string, WeekSchedule | ConversationRoutine>,
  isGroupChat: boolean,
  opts: { maxFollowups?: number } = {},
): AutonomousCheckResult {
  const noTrigger: AutonomousCheckResult = {
    shouldTrigger: false,
    characterIds: [],
    reason: "none",
    inactivityMs: 0,
  };

  const state = activityStates.get(chatId);
  if (!state) return noTrigger;

  // Auto-reset stuck generation flag after timeout
  if (state.generationInProgressSince) {
    if (Date.now() - state.generationInProgressSince > GENERATION_TIMEOUT_MS) {
      state.generationInProgressSince = null;
    } else {
      return noTrigger;
    }
  }

  const now = Date.now();
  const inactivityMs = now - state.lastUserMessageAt;

  // Don't trigger if user has never sent a message (fresh chat)
  if (state.lastUserMessageAt === 0) return noTrigger;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Check each character for inactivity threshold Ã¢â€â‚¬Ã¢â€â‚¬
  const eligibleCharacters: Array<{ id: string; priority: number }> = [];

  // Maximum autonomous follow-ups before a character stops messaging
  const maxFollowups = Math.max(1, Math.min(3, Math.floor(opts.maxFollowups ?? 3)));

  for (const [charId, schedule] of Object.entries(characterSchedules)) {
    const decision = getAvailabilityDecision(schedule);
    const policy = getAvailabilityAutonomousPolicy(decision);

    // Can't send if unavailable or blocked by the availability layer.
    if (!policy.canMessageFirst) continue;

    // Base inactivity threshold
    const baseThresholdMs = schedule.inactivityThresholdMinutes * 60 * 1000 * policy.inactivityThresholdMultiplier;

    const prevAutonomous = state.autonomousMessages.get(charId);
    const sentCount = prevAutonomous?.count ?? 0;

    // Cap follow-ups Ã¢â‚¬â€ don't spam the user endlessly
    if (sentCount >= maxFollowups) continue;

    if (sentCount === 0) {
      // First autonomous message Ã¢â‚¬â€ use normal inactivity from user's last message
      if (inactivityMs >= baseThresholdMs) {
        eligibleCharacters.push({
          id: charId,
          priority: schedule.talkativeness + (decision.status === "online" ? 20 : 0),
        });
      }
    } else {
      // Follow-up messages Ã¢â‚¬â€ measure from the last autonomous message, with escalating cooldown
      // Each follow-up doubles the cooldown: 2x, 4x base threshold
      const cooldownMultiplier = Math.pow(2, sentCount);
      const followUpThresholdMs = baseThresholdMs * cooldownMultiplier;
      const timeSinceLastAutonomous = now - (prevAutonomous?.lastSentAt ?? 0);

      if (timeSinceLastAutonomous >= followUpThresholdMs) {
        eligibleCharacters.push({
          id: charId,
          priority: schedule.talkativeness + (decision.status === "online" ? 20 : 0) - sentCount * 10, // Lower priority for repeat messages
        });
      }
    }
  }

  if (eligibleCharacters.length === 0) return noTrigger;

  // Sort by priority (highest first)
  eligibleCharacters.sort((a, b) => b.priority - a.priority);

  if (isGroupChat) {
    // In group chats, potentially multiple characters can exchange
    // but start with just the top character
    return {
      shouldTrigger: true,
      characterIds: [eligibleCharacters[0]!.id],
      reason: "user_inactivity",
      inactivityMs,
    };
  }

  // In DMs, only one character
  return {
    shouldTrigger: true,
    characterIds: [eligibleCharacters[0]!.id],
    reason: "user_inactivity",
    inactivityMs,
  };
}

/**
 * For group chats: check if characters should chat with each other.
 * This is triggered after an assistant message, to see if another character
 * wants to respond to what was just said.
 */
function checkCharacterExchange(
  chatId: string,
  lastSpeakerCharId: string,
  characterSchedules: Record<string, WeekSchedule | ConversationRoutine>,
): AutonomousCheckResult {
  const noTrigger: AutonomousCheckResult = {
    shouldTrigger: false,
    characterIds: [],
    reason: "none",
    inactivityMs: 0,
  };

  const state = activityStates.get(chatId);
  if (!state) return noTrigger;
  if (state.generationInProgressSince) {
    if (Date.now() - state.generationInProgressSince > GENERATION_TIMEOUT_MS) {
      state.generationInProgressSince = null;
    } else {
      return noTrigger;
    }
  }

  // Only allow character exchanges if user has been inactive for at least 30 seconds
  const inactivityMs = Date.now() - state.lastUserMessageAt;
  if (inactivityMs < 30_000) return noTrigger;

  const eligible: Array<{ id: string; weight: number }> = [];

  for (const [charId, schedule] of Object.entries(characterSchedules)) {
    if (charId === lastSpeakerCharId) continue;

    const decision = getAvailabilityDecision(schedule);
    if (!getAvailabilityAutonomousPolicy(decision).canJoinCharacterExchange) continue;

    // Weight based on talkativeness Ã¢â‚¬â€ more talkative characters more likely to jump in
    eligible.push({ id: charId, weight: schedule.talkativeness });
  }

  if (eligible.length === 0) return noTrigger;

  // Probabilistic: roll dice weighted by talkativeness
  // A character with talkativeness 80 has an 80% chance of responding
  const candidate = eligible[Math.floor(Math.random() * eligible.length)]!;
  const roll = Math.random() * 100;
  if (roll > candidate.weight) return noTrigger;

  return {
    shouldTrigger: true,
    characterIds: [candidate.id],
    reason: "character_exchange",
    inactivityMs,
  };
}

/**
 * Clean up activity state for a chat (when chat is deleted or closed).
 */
export function clearChatActivity(chatId: string): void {
  activityStates.delete(chatId);
}
