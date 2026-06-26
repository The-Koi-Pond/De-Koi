type ConversationStatusKind = "online" | "idle" | "dnd" | "offline";

import type { LlmGateway, LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { parseJsonArray, parseJsonObject } from "../../../core/json";
import { getCurrentStatus, getEnabledConversationSchedules } from "../schedules/schedule.service";

export interface ConversationStatusMessageMeta {
  generatedAt: string;
  nextRefreshAt: string;
  sourceStatus: ConversationStatusKind;
  sourceActivity: string;
}

export interface ShouldRefreshStatusMessageArgs {
  enabled: boolean;
  extensions: Record<string, unknown>;
  currentStatus: ConversationStatusKind;
  currentActivity: string;
  now?: Date;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface StatusMessageCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

interface MaybeRefreshConversationStatusMessagesInput {
  chatId: string;
  characterIds?: string[];
  now?: Date;
}

export interface ConversationStatusMessageRefreshResult {
  refreshed: string[];
  skipped: string[];
}

const VALID_STATUSES = new Set<ConversationStatusKind>(["online", "idle", "dnd", "offline"]);
const STATUS_MESSAGE_REFRESH_MIN_MS = 45 * 60 * 1000;
const STATUS_MESSAGE_REFRESH_JITTER_MS = 90 * 60 * 1000;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isStatus(value: string): value is ConversationStatusKind {
  return VALID_STATUSES.has(value as ConversationStatusKind);
}

export function readStatusMessageMeta(extensions: Record<string, unknown>): ConversationStatusMessageMeta | null {
  const meta = readRecord(extensions.conversationStatusMessageMeta);
  const sourceStatus = readString(meta.sourceStatus);
  const generatedAt = readString(meta.generatedAt);
  const nextRefreshAt = readString(meta.nextRefreshAt);
  const sourceActivity = readString(meta.sourceActivity);
  if (!generatedAt || !nextRefreshAt || !sourceActivity || !isStatus(sourceStatus)) return null;
  return { generatedAt, nextRefreshAt, sourceStatus, sourceActivity };
}

export function shouldRefreshStatusMessage(args: ShouldRefreshStatusMessageArgs): boolean {
  if (!args.enabled) return false;
  const message = readString(args.extensions.conversationStatusMessage);
  if (!message) return true;
  const meta = readStatusMessageMeta(args.extensions);
  if (!meta) return true;
  if (meta.sourceStatus !== args.currentStatus) return true;
  if (meta.sourceActivity !== args.currentActivity.trim()) return true;
  const nowMs = (args.now ?? new Date()).getTime();
  const nextMs = Date.parse(meta.nextRefreshAt);
  if (!Number.isFinite(nextMs)) return true;
  return nowMs >= nextMs;
}

function nextRefreshIso(now: Date, characterId: string): string {
  let hash = 0;
  for (const char of characterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const jitter = hash % STATUS_MESSAGE_REFRESH_JITTER_MS;
  return new Date(now.getTime() + STATUS_MESSAGE_REFRESH_MIN_MS + jitter).toISOString();
}

function sanitizeStatusMessage(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 96);
}

function parseGeneratedStatusMessage(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as JsonRecord;
    const message = typeof parsed.message === "string" ? parsed.message : "";
    return sanitizeStatusMessage(message);
  } catch {
    return sanitizeStatusMessage(trimmed);
  }
}

function statusFromExtensions(extensions: JsonRecord): ConversationStatusKind {
  const raw = readString(extensions.conversationStatus);
  return isStatus(raw) ? raw : "online";
}

function buildStatusMessagePrompt(args: {
  name: string;
  description: string;
  personality: string;
  currentStatus: ConversationStatusKind;
  currentActivity: string;
  recentContext: string;
}): LlmMessage[] {
  const system = [
    "Generate one short present-tense status blurb for a fictional chat character.",
    "The blurb appears under their name like a social status message.",
    "Use the character's personality, current availability, current activity, and recent continuity.",
    "Do not invent a major life event. Do not mention being an AI or mention this instruction.",
    'Return JSON only: {"message":"short status blurb"}.',
    "The message must be 2-10 words, lowercase or sentence case, with no emoji unless character-appropriate.",
    "",
    `Character: ${args.name}`,
    `Description: ${args.description}`,
    `Personality: ${args.personality}`,
    `Availability: ${args.currentStatus}`,
    `Current activity: ${args.currentActivity}`,
    args.recentContext ? `Recent continuity: ${args.recentContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: "Generate the status blurb now." },
  ];
}

function recentContinuityFromChat(meta: JsonRecord, characterData: JsonRecord): string {
  const parts: string[] = [];
  const summary = readString(meta.summary);
  if (summary) parts.push(`Summary: ${summary.slice(0, 500)}`);
  const memories = parseJsonArray<JsonRecord>(parseJsonObject(characterData.extensions).characterMemories)
    .map((memory) => readString(memory.summary))
    .filter(Boolean)
    .slice(-5);
  if (memories.length > 0) parts.push(`Memories: ${memories.join("; ").slice(0, 700)}`);
  return parts.join("\n").slice(0, 1200);
}

async function resolveConnection(storage: StorageGateway, chat: JsonRecord): Promise<JsonRecord | null> {
  const chatConnectionId = readString(chat.connectionId);
  if (chatConnectionId && chatConnectionId !== "random") {
    return (await storage.get<JsonRecord>("connections", chatConnectionId)) ?? null;
  }
  const connections = await storage.list<JsonRecord>("connections");
  if (chatConnectionId === "random") {
    return connections.find((connection) => connection.useForRandom === true) ?? connections[0] ?? null;
  }
  return (
    connections.find((connection) => connection.isDefault === true || connection.default === true) ??
    connections[0] ??
    null
  );
}

function describeConnectionTarget(chat: JsonRecord): string {
  const chatConnectionId = readString(chat.connectionId);
  if (chatConnectionId === "random") return "random/default connection";
  if (chatConnectionId) return `configured connection "${chatConnectionId}"`;
  return "default connection";
}

export async function maybeRefreshConversationStatusMessages(
  capabilities: StatusMessageCapabilities,
  input: MaybeRefreshConversationStatusMessagesInput,
): Promise<ConversationStatusMessageRefreshResult> {
  const chat = await capabilities.storage.get<JsonRecord>("chats", input.chatId);
  if (!chat || chat.mode !== "conversation") return { refreshed: [], skipped: [] };

  const meta = parseJsonObject(chat.metadata);
  const enabled = meta.conversationStatusMessagesEnabled === true;
  const ids = input.characterIds?.length ? input.characterIds : parseJsonArray<string>(chat.characterIds).filter(Boolean);
  const schedules = getEnabledConversationSchedules(meta);
  if (!enabled || ids.length === 0) return { refreshed: [], skipped: ids };
  const connection = await resolveConnection(capabilities.storage, chat);
  if (!connection) {
    throw new Error(
      `Conversation status blurbs enabled but no usable connection could be resolved for ${describeConnectionTarget(chat)}.`,
    );
  }
  const connectionId = readString(connection.id);
  const model = readString(connection.model);
  if (!connectionId || !model) {
    throw new Error(
      `Conversation status blurbs enabled but connection data for ${describeConnectionTarget(chat)} is incomplete.`,
    );
  }

  const now = input.now ?? new Date();
  const refreshed: string[] = [];
  const skipped: string[] = [];

  for (const characterId of ids) {
    const character = await capabilities.storage.get<JsonRecord>("characters", characterId);
    if (!character) {
      skipped.push(characterId);
      continue;
    }

    const data = parseJsonObject(character.data);
    const extensions = parseJsonObject(data.extensions);
    const scheduled = schedules[characterId] ? getCurrentStatus(schedules[characterId]!, now) : null;
    const currentStatus = scheduled?.status ?? statusFromExtensions(extensions);
    const currentActivity = (scheduled?.activity ?? readString(extensions.conversationActivity)) || "free time";

    if (!shouldRefreshStatusMessage({ enabled, extensions, currentStatus, currentActivity, now })) {
      skipped.push(characterId);
      continue;
    }

    const raw = await capabilities.llm.complete({
      connectionId,
      model,
      messages: buildStatusMessagePrompt({
        name: readString(data.name) || "Character",
        description: readString(data.description),
        personality: readString(data.personality),
        currentStatus,
        currentActivity,
        recentContext: recentContinuityFromChat(meta, data),
      }),
      parameters: { temperature: 0.9, maxTokens: 80 },
    });
    const message = parseGeneratedStatusMessage(raw);
    if (!message) {
      skipped.push(characterId);
      continue;
    }

    await capabilities.storage.update("characters", characterId, {
      data: {
        ...data,
        extensions: {
          ...extensions,
          conversationStatusMessage: message,
          conversationStatusMessageMeta: {
            generatedAt: now.toISOString(),
            nextRefreshAt: nextRefreshIso(now, characterId),
            sourceStatus: currentStatus,
            sourceActivity: currentActivity,
          },
        },
      },
    });
    refreshed.push(characterId);
  }

  return { refreshed, skipped };
}
