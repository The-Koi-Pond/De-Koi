import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput } from "../contracts/types/memory";
import {
  resolveAutomaticMemoryScope,
  type CharacterMemoryScopeCharacter,
} from "./character-memory-scope";
import { nowIso, parseArray, parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";

const MEMORY_CAPTURE_JOBS_COLLECTION: StorageEntity = "memory-capture-jobs";
const AUTOMATIC_MEMORY_CAPTURE_VERSION = 2;
const MAX_CAPTURE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

type MemoryCaptureJobStatus = "pending" | "processing" | "retryable" | "completed" | "failed" | "stale";

interface SourceMessageSnapshot {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId: string | null;
  createdAt: string;
}

interface MemoryCaptureJob extends JsonRecord {
  id: string;
  status: MemoryCaptureJobStatus;
  chatId: string;
  sourceChatId: string;
  sourceMessageIds: string[];
  sourceMessages: SourceMessageSnapshot[];
  assistantMessageId: string;
  userMessageId?: string | null;
  mode?: string | null;
  scopeType: "chat";
  scopeKind: "character" | "chat" | "scene";
  scopeId: string;
  scopeReason: "attributed_character" | "character_chat_only" | "ambiguous_scene" | "ambiguous_chat";
  characterId?: string | null;
  sceneId?: string | null;
  captureVersion: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomaticMemoryCaptureScheduleInput {
  chat: JsonRecord;
  characters: CharacterMemoryScopeCharacter[];
  savedUserMessage?: unknown;
  savedAssistantMessage: unknown;
}

export interface AutomaticMemoryCaptureProcessOptions {
  now?: string;
  limit?: number;
}

export interface AutomaticMemoryCaptureCompletion {
  chatId: string;
  assistantMessageId: string;
  operation: "created" | "updated";
  memory: { id: string; content: string };
}

type AutomaticMemoryCaptureCompletionListener = (completion: AutomaticMemoryCaptureCompletion) => void;

const completionListeners = new Set<AutomaticMemoryCaptureCompletionListener>();

export function subscribeAutomaticMemoryCaptureCompletions(
  listener: AutomaticMemoryCaptureCompletionListener,
): () => void {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

function memoryCaptureFromRefresh(value: unknown): Omit<AutomaticMemoryCaptureCompletion, "chatId" | "assistantMessageId"> | null {
  const capture = parseRecord(parseRecord(value).capture);
  const memory = parseRecord(capture.memory);
  const operation = readString(capture.operation).trim();
  const id = readString(memory.id).trim();
  const content = readString(memory.content).trim();
  if ((operation !== "created" && operation !== "updated") || !id || !content) return null;
  return { operation, memory: { id, content } };
}

function publishMemoryCaptureCompletion(completion: AutomaticMemoryCaptureCompletion): void {
  for (const listener of completionListeners) {
    try {
      listener(completion);
    } catch {
      // UI observers cannot invalidate a capture that is already durable.
    }
  }
}

const activeWorkers = new WeakSet<StorageGateway>();
const pendingWorkerReruns = new WeakSet<StorageGateway>();

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function jobIdFor(chatId: string, sourceMessageIds: string[]): string {
  return `memory-capture-${stableHash(`${AUTOMATIC_MEMORY_CAPTURE_VERSION}\u001f${chatId}\u001f${sourceMessageIds.join("\u001f")}`)}`;
}

function canonicalMemoryIdForJob(jobId: string): string {
  return `canonical-${jobId}`;
}

function sourceSnapshot(value: unknown): SourceMessageSnapshot | null {
  const record = parseRecord(value);
  const id = readString(record.id).trim();
  const chatId = readString(record.chatId).trim();
  const role = readString(record.role).trim();
  const content = readString(record.content).trim();
  if (!id || !chatId || !role || !content) return null;
  return {
    id,
    chatId,
    role,
    content,
    characterId: readString(record.characterId).trim() || null,
    createdAt: readString(record.createdAt).trim(),
  };
}

function sourceSnapshotsFromJob(job: JsonRecord): SourceMessageSnapshot[] {
  return parseArray(job.sourceMessages)
    .map((value) => sourceSnapshot(value))
    .filter((value): value is SourceMessageSnapshot => value !== null);
}

function jobStatus(job: JsonRecord): MemoryCaptureJobStatus {
  const status = readString(job.status).trim();
  if (["pending", "processing", "retryable", "completed", "failed", "stale"].includes(status)) {
    return status as MemoryCaptureJobStatus;
  }
  return "pending";
}

function jobDue(job: JsonRecord, now: string): boolean {
  const status = jobStatus(job);
  if (status === "pending" || status === "processing") return true;
  if (status !== "retryable") return false;
  const nextAttemptAt = readString(job.nextAttemptAt).trim();
  return !nextAttemptAt || nextAttemptAt <= now;
}

function retryTime(now: string, attempts: number): string {
  const delay = RETRY_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)];
  const timestamp = Date.parse(now);
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + delay).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Automatic memory capture failed");
}

function jobSourceIds(job: JsonRecord): string[] {
  return parseArray(job.sourceMessageIds)
    .map((value) => readString(value).trim())
    .filter(Boolean);
}

async function updateJob(storage: StorageGateway, id: string, patch: Record<string, unknown>): Promise<JsonRecord> {
  return storage.update<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, id, patch);
}

async function validateSourceMessages(storage: StorageGateway, job: JsonRecord): Promise<string | null> {
  const snapshots = sourceSnapshotsFromJob(job);
  if (snapshots.length === 0) return "missing_source_snapshot";
  for (const snapshot of snapshots) {
    const current = await storage.getChatMessage<JsonRecord>(snapshot.id, {
      fields: ["id", "chatId", "role", "content", "characterId", "createdAt"],
    });
    if (!current) return "source_message_deleted";
    if (readString(current.chatId).trim() !== snapshot.chatId) return "source_chat_changed";
    if (readString(current.role).trim() !== snapshot.role) return "source_role_changed";
    if (readString(current.content).trim() !== snapshot.content) return "source_content_changed";
    const currentCharacterId = readString(current.characterId).trim() || null;
    if (currentCharacterId !== snapshot.characterId) return "source_character_changed";
  }
  return null;
}

async function upsertCanonicalCharacterMemory(
  storage: StorageGateway,
  job: JsonRecord,
  capture: Omit<AutomaticMemoryCaptureCompletion, "chatId" | "assistantMessageId">,
  now: string,
): Promise<void> {
  if (readString(job.scopeKind).trim() !== "character") return;
  const characterId = readString(job.characterId).trim();
  const jobId = readString(job.id).trim();
  if (!characterId || !jobId) return;
  if (!storage.createMemory || !storage.updateMemory) {
    throw new Error("Canonical memory storage is unavailable");
  }

  const sourceMessages = sourceSnapshotsFromJob(job);
  const memoryId = canonicalMemoryIdForJob(jobId);
  const mode = readString(job.mode).trim();
  const input: CanonicalMemoryInput = {
    id: memoryId,
    kind: "episode",
    status: "active",
    scope: { kind: "character", id: characterId },
    content: capture.memory.content,
    confidence: 1,
    provenance: {
      sourceChatId: readString(job.chatId).trim(),
      messageIds: jobSourceIds(job),
      sceneId: readString(job.sceneId).trim() || null,
      characterId,
      timestamp:
        sourceMessages.find((message) => message.id === readString(job.assistantMessageId).trim())?.createdAt || null,
    },
    tags: ["automatic", mode].filter(Boolean),
    payload: {
      automatic: true,
      captureVersion: AUTOMATIC_MEMORY_CAPTURE_VERSION,
      captureJobId: jobId,
    },
    createdAt: now,
    updatedAt: now,
  };
  const existing = await storage.get("canonical-memories", memoryId).catch(() => null);
  if (existing) {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...patch } = input;
    await storage.updateMemory(memoryId, patch);
  } else {
    await storage.createMemory(input);
  }

  if (storage.rebuildMemoryIndex) {
    try {
      await storage.rebuildMemoryIndex({ scope: { kind: "character", id: characterId } });
    } catch (error) {
      await updateJob(storage, jobId, {
        canonicalIndexError: errorMessage(error),
        canonicalIndexFailedAt: now,
        updatedAt: now,
      });
    }
  }
}

export async function enqueueAutomaticMemoryCaptureJob(
  storage: StorageGateway,
  input: AutomaticMemoryCaptureScheduleInput,
  now = nowIso(),
): Promise<JsonRecord | null> {
  const chat = input.chat;
  const assistant = sourceSnapshot(input.savedAssistantMessage);
  if (!assistant || assistant.role !== "assistant") return null;
  const user = sourceSnapshot(input.savedUserMessage);
  const sourceMessages = [user, assistant].filter((value): value is SourceMessageSnapshot => value !== null);
  const sourceMessageIds = sourceMessages.map((message) => message.id);
  const chatId = readString(chat.id).trim() || assistant.chatId;
  if (!chatId || sourceMessageIds.length === 0) return null;
  const mode = readString(chat.mode || chat.chatMode).trim();
  const sceneId = readString(chat.sceneId || chat.activeSceneId).trim() || null;
  const resolvedScope = resolveAutomaticMemoryScope({
    chatId,
    mode,
    sceneId,
    assistantCharacterId: assistant.characterId,
    activeCharacters: input.characters,
  });

  const id = jobIdFor(chatId, sourceMessageIds);
  const existing = await storage.get<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, id).catch(() => null);
  const base: MemoryCaptureJob = {
    id,
    status: "pending",
    chatId,
    sourceChatId: chatId,
    sourceMessageIds,
    sourceMessages,
    assistantMessageId: assistant.id,
    userMessageId: user?.id ?? null,
    mode: mode || null,
    scopeType: "chat",
    scopeKind: resolvedScope.scope.kind,
    scopeId: resolvedScope.scope.id,
    scopeReason: resolvedScope.reason,
    characterId: resolvedScope.characterId,
    sceneId,
    captureVersion: AUTOMATIC_MEMORY_CAPTURE_VERSION,
    attempts: 0,
    maxAttempts: MAX_CAPTURE_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: readString(existing?.createdAt).trim() || now,
    updatedAt: now,
  };

  if (existing) {
    if (jobStatus(existing) === "completed") return existing;
    return updateJob(storage, id, base);
  }
  return storage.create<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, base);
}

export async function processAutomaticMemoryCaptureQueue(
  storage: StorageGateway,
  options: AutomaticMemoryCaptureProcessOptions = {},
): Promise<{ processed: number; completed: number; retryable: number; failed: number; stale: number }> {
  if (!storage.refreshChatMemories) return { processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };
  const now = options.now ?? nowIso();
  const jobs = await storage.list<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION).catch(() => []);
  const dueJobs = jobs
    .filter((job) => jobDue(job, now))
    .sort((left, right) => readString(left.createdAt).localeCompare(readString(right.createdAt)))
    .slice(0, options.limit ?? 10);
  const result = { processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };

  for (const job of dueJobs) {
    const id = readString(job.id).trim();
    if (!id) continue;
    const attempts = readNumber(job.attempts, 0) + 1;
    const maxAttempts = Math.max(1, readNumber(job.maxAttempts, MAX_CAPTURE_ATTEMPTS));
    result.processed += 1;
    await updateJob(storage, id, {
      status: "processing",
      attempts,
      startedAt: now,
      updatedAt: now,
      lastError: null,
    });

    const staleReason = await validateSourceMessages(storage, job);
    if (staleReason) {
      await updateJob(storage, id, {
        status: "stale",
        staleReason,
        completedAt: now,
        updatedAt: now,
      });
      result.stale += 1;
      continue;
    }

    try {
      const sourceMessageIds = jobSourceIds(job);
      const chatId = readString(job.chatId).trim();
      const refreshResult = await storage.refreshChatMemories(chatId, { sourceMessageIds });
      const capture = memoryCaptureFromRefresh(refreshResult);
      if (capture) {
        await upsertCanonicalCharacterMemory(storage, job, capture, now);
      }
      const assistantMessageId = readString(job.assistantMessageId).trim();
      if (assistantMessageId) {
        await storage.patchChatMessageExtra(assistantMessageId, {
          memoryCapture: {
            status: "completed",
            jobId: id,
            sourceMessageIds,
            completedAt: now,
            ...(capture ? { capture } : {}),
          },
        });
      }
      await updateJob(storage, id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
        lastError: null,
        nextAttemptAt: null,
      });
      result.completed += 1;
      if (capture && assistantMessageId) {
        publishMemoryCaptureCompletion({ chatId, assistantMessageId, ...capture });
      }
    } catch (error) {
      const terminal = attempts >= maxAttempts;
      await updateJob(storage, id, {
        status: terminal ? "failed" : "retryable",
        lastError: errorMessage(error),
        failedAt: terminal ? now : null,
        nextAttemptAt: terminal ? null : retryTime(now, attempts),
        updatedAt: now,
      });
      if (terminal) result.failed += 1;
      else result.retryable += 1;
    }
  }

  return result;
}

export function scheduleAutomaticMemoryCaptureQueueProcessing(storage: StorageGateway): void {
  if (activeWorkers.has(storage)) {
    pendingWorkerReruns.add(storage);
    return;
  }
  activeWorkers.add(storage);
  void processAutomaticMemoryCaptureQueue(storage).finally(() => {
    activeWorkers.delete(storage);
    if (pendingWorkerReruns.has(storage)) {
      pendingWorkerReruns.delete(storage);
      scheduleAutomaticMemoryCaptureQueueProcessing(storage);
    }
  });
}

export async function enqueueAndScheduleAutomaticMemoryCapture(
  storage: StorageGateway,
  input: AutomaticMemoryCaptureScheduleInput,
): Promise<JsonRecord | null> {
  const job = await enqueueAutomaticMemoryCaptureJob(storage, input);
  if (job) scheduleAutomaticMemoryCaptureQueueProcessing(storage);
  return job;
}
