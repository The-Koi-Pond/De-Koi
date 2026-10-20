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
import { getChatActivityState, setChatActivityState, type AutonomousClientPresenceStatus } from "./activity-state.js";
import { characterExtensionsPatch } from "../../../entities/character-extensions-patch";

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
      name: string | null;
      status: string;
      activity: string;
      schedule?: unknown;
      routine?: unknown;
      availabilityExplanation: ReturnType<typeof getAvailabilityExplanation>;
    }
  >;
  needsRefresh: boolean;
  persistedCharacterIds: string[];
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
  extra?: unknown;
};

type StoredCharacter = {
  id?: unknown;
  name?: unknown;
  data?: unknown;
};

type UserStatus = "active" | "idle" | "dnd";

const AUTONOMOUS_ACTIVITY_MESSAGE_LIMIT = 80;
const AUTONOMOUS_ACTIVITY_MESSAGE_FIELDS = ["role", "createdAt", "characterId", "extra"];

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
    // Only the marker that says a reply answered a user message; the rest of `extra` can be large.
    fieldSelections: { extra: ["answersUserVersion"] },
  });
  return Array.isArray(rows) ? (rows as StoredMessage[]) : [];
}

/** A Conversation reply carries `extra.answersUserVersion`; a message a character sent on its own does not. */
function answersUser(extra: unknown): boolean {
  return Boolean(metadataRecord(extra).answersUserVersion);
}

function characterSchedules(meta: Record<string, unknown>): Record<string, WeekSchedule> {
  return getEnabledConversationSchedules(meta);
}

function characterRoutines(meta: Record<string, unknown>): Record<string, ConversationRoutine> {
  return getEnabledConversationRoutines(meta);
}

async function syncStoredConversationStatus(
  storage: StorageGateway,
  character: StoredCharacter | null | undefined,
  characterId: string,
  status: {
    status: string;
    activity: string;
    availabilityExplanation?: string;
    source?: "routine" | "schedule";
  } | null,
): Promise<boolean> {
  if (!character) return false;
  const extensions = metadataRecord(metadataRecord(character.data).extensions);
  const changes: Record<string, string | undefined> = {
    conversationStatus: status?.status,
    conversationActivity: status?.activity,
    conversationStatusSource: status ? (status.source ?? "schedule") : undefined,
    conversationAvailabilityExplanation: status?.availabilityExplanation || undefined,
  };
  // A cleared key is stored as null, so compare it the same way as an absent one.
  if (Object.entries(changes).every(([key, value]) => (extensions[key] ?? undefined) === value)) {
    return false;
  }
  await storage.update("characters", characterId, characterExtensionsPatch(changes));
  return true;
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

async function loadConversationStatusCharacters(
  storage: StorageGateway,
  characterIds: string[],
): Promise<Map<string, StoredCharacter>> {
  if (characterIds.length === 0) return new Map();
  const rows = await storage.list<StoredCharacter>("characters", {
    whereIn: { field: "id", values: characterIds },
  });
  const byId = new Map<string, StoredCharacter>();
  for (const row of rows) {
    if (typeof row.id === "string" && row.id.trim().length > 0) {
      byId.set(row.id, row);
    }
  }
  return byId;
}

const conversationStatusInFlight = new WeakMap<StorageGateway, Map<string, Promise<ConversationStatusResult>>>();

function conversationStatusRequests(storage: StorageGateway): Map<string, Promise<ConversationStatusResult>> {
  let requests = conversationStatusInFlight.get(storage);
  if (!requests) {
    requests = new Map();
    conversationStatusInFlight.set(storage, requests);
  }
  return requests;
}

export function getConversationStatus(storage: StorageGateway, chatId: string): Promise<ConversationStatusResult> {
  const requests = conversationStatusRequests(storage);
  const existing = requests.get(chatId);
  if (existing) return existing;
  const request = computeConversationStatus(storage, chatId).finally(() => {
    if (requests.get(chatId) === request) {
      requests.delete(chatId);
    }
  });
  requests.set(chatId, request);
  return request;
}
async function computeConversationStatus(storage: StorageGateway, chatId: string): Promise<ConversationStatusResult> {
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
  const characterIds = Array.from(new Set(chatCharacterIds(chat)));
  const characterRows = await loadConversationStatusCharacters(storage, characterIds);
  const statusSyncs: Array<Promise<string | null>> = [];

  for (const characterId of characterIds) {
    const character = characterRows.get(characterId);
    const characterData = metadataRecord(character?.data);
    const dataName = typeof characterData.name === "string" ? characterData.name.trim() : "";
    const rowName = typeof character?.name === "string" ? character.name.trim() : "";
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
      name: dataName || rowName || null,
      status: availability.status,
      activity: availability.activity,
      schedule,
      routine,
      availabilityExplanation,
    };
    if (profile) {
      statusSyncs.push(
        syncStoredConversationStatus(storage, characterRows.get(characterId), characterId, {
          status: availability.status,
          activity: availability.activity,
          availabilityExplanation: availabilityExplanation.message,
          source: routine ? "routine" : "schedule",
        }).then((persisted) => (persisted ? characterId : null)),
      );
    } else {
      statusSyncs.push(
        syncStoredConversationStatus(storage, characterRows.get(characterId), characterId, null).then((persisted) =>
          persisted ? characterId : null,
        ),
      );
    }
  }

  const persistedCharacterIds = (await Promise.all(statusSyncs)).filter((id): id is string => !!id);

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

  return { statuses, needsRefresh, persistedCharacterIds };
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
  syncActivityFromMessages(
    input.chatId,
    messages.map((message) => ({
      role: typeof message.role === "string" ? message.role : "message",
      createdAt: typeof message.createdAt === "string" ? message.createdAt : undefined,
      characterId: typeof message.characterId === "string" ? message.characterId : null,
      answersUser: answersUser(message.extra),
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
        const decision = getAvailabilityDecision(
          routines[characterId] ?? schedules[characterId] ?? autonomyProfiles[characterId]!,
        );
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
  return checkCharacterExchange(input.chatId, input.lastSpeakerCharId, {
    ...characterSchedules(meta),
    ...characterRoutines(meta),
  });
}

/** Auto-reset generationInProgress after this many ms (5 minutes) */
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

// Ã¢â€â‚¬Ã¢â€â‚¬ In-memory activity tracker Ã¢â€â‚¬Ã¢â€â‚¬
// Keyed by chatId. This is intentionally in-memory since it's just timing state.

/**
 * Record that the user sent a message in a chat.
 */
export function recordUserActivity(chatId: string, opts: { preserveGenerationInProgress?: boolean } = {}): void {
  const now = Date.now();
  const existing = getChatActivityState(chatId);
  if (existing) {
    existing.lastUserMessageAt = now;
    existing.autonomousMessages.clear(); // Reset Ã¢â‚¬â€ user is active again
    if (!opts.preserveGenerationInProgress) {
      existing.generationInProgressSince = null;
    }
  } else {
    setChatActivityState(chatId, {
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
  const existing = getChatActivityState(chatId);
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
  const state = getChatActivityState(chatId);
  if (state) {
    state.generationInProgressSince = now;
  } else {
    setChatActivityState(chatId, {
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
  const state = getChatActivityState(chatId);
  if (!state) return;
  if (startedAt != null && state.generationInProgressSince !== startedAt) return;
  state.generationInProgressSince = null;
}

/**
 * Bring the in-memory activity state in line with the stored transcript before each check.
 *
 * The transcript is the record of what was actually sent: the user's last message, and every message a
 * character sent on its own after it (no `answersUser` marker). Counting those here means the follow-up
 * cooldown and cap hold even when a caller didn't record its send, and after a server restart or a fresh page
 * load. Without it the hosted runner re-sent a "texts first" message on every 30-second poll.
 */
function syncActivityFromMessages(
  chatId: string,
  messages: Array<{ role: string; createdAt?: string; characterId?: string | null; answersUser: boolean }>,
): void {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return; // No user message in view: nothing to measure inactivity from.

  const time = (message: { createdAt?: string }) => (message.createdAt ? new Date(message.createdAt).getTime() : 0);
  const lastUserAt = time(messages[lastUserIndex]!);
  let lastAssistantAt = 0;
  const sent = new Map<string, { count: number; lastSentAt: number }>();
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    lastAssistantAt = Math.max(lastAssistantAt, time(message));
    if (index <= lastUserIndex || message.answersUser || !message.characterId) return;
    const previous = sent.get(message.characterId);
    sent.set(message.characterId, {
      count: (previous?.count ?? 0) + 1,
      lastSentAt: Math.max(previous?.lastSentAt ?? 0, time(message)),
    });
  });

  const state = getChatActivityState(chatId);
  if (!state) {
    setChatActivityState(chatId, {
      lastUserMessageAt: lastUserAt,
      lastAssistantMessageAt: lastAssistantAt,
      autonomousMessages: sent,
      generationInProgressSince: null,
    });
    return;
  }

  if (lastUserAt > state.lastUserMessageAt) {
    // The user wrote since this state was recorded (another tab or device): start the count over.
    state.lastUserMessageAt = lastUserAt;
    state.autonomousMessages.clear();
  }
  state.lastAssistantMessageAt = Math.max(state.lastAssistantMessageAt, lastAssistantAt);
  for (const [characterId, stored] of sent) {
    const recorded = state.autonomousMessages.get(characterId);
    if (!recorded || stored.count > recorded.count) state.autonomousMessages.set(characterId, stored);
  }
}

export function recordAutonomousClientPresence(
  chatId: string,
  status: AutonomousClientPresenceStatus = "active",
): void {
  const now = Date.now();
  const state = getChatActivityState(chatId);
  if (state) {
    state.clientPresence = { status, updatedAt: now };
    return;
  }

  setChatActivityState(chatId, {
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

  const state = getChatActivityState(chatId);
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

  const state = getChatActivityState(chatId);
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
