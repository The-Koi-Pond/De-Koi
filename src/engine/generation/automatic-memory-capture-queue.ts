import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryRecord, MemoryScope } from "../contracts/types/memory";
import {
  canonicalMemoryEligibleForConsequences,
  extractCanonicalMemoryConsequences,
  persistCanonicalMemoryConsequences,
  type PersistedCanonicalConsequence,
} from "./automatic-memory-capture";
import { resolveAutomaticMemoryScope, type CharacterMemoryScopeCharacter } from "./character-memory-scope";
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
  connectionId?: string | null;
  model?: string | null;
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
  connectionId?: string | null;
  model?: string | null;
}

export interface AutomaticMemoryCaptureProcessOptions {
  now?: string;
  limit?: number;
}

export interface AutomaticMemoryCaptureQueueDependencies {
  storage: StorageGateway;
  llm: LlmGateway;
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

function memoryCaptureFromRefresh(
  value: unknown,
): Omit<AutomaticMemoryCaptureCompletion, "chatId" | "assistantMessageId"> | null {
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
const foregroundGenerationCounts = new WeakMap<StorageGateway, number>();
const deferredWorkerDependencies = new WeakMap<
  StorageGateway,
  StorageGateway | AutomaticMemoryCaptureQueueDependencies
>();

function foregroundGenerationActive(storage: StorageGateway): boolean {
  return (foregroundGenerationCounts.get(storage) ?? 0) > 0;
}

function deferWorkerUntilForegroundCompletes(
  storage: StorageGateway,
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
): void {
  deferredWorkerDependencies.set(storage, dependencies);
}

export function beginForegroundGeneration(storage: StorageGateway): () => void {
  foregroundGenerationCounts.set(storage, (foregroundGenerationCounts.get(storage) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, (foregroundGenerationCounts.get(storage) ?? 1) - 1);
    if (remaining > 0) {
      foregroundGenerationCounts.set(storage, remaining);
      return;
    }
    foregroundGenerationCounts.delete(storage);
    const deferredDependencies = deferredWorkerDependencies.get(storage);
    if (!deferredDependencies) return;
    deferredWorkerDependencies.delete(storage);
    scheduleAutomaticMemoryCaptureQueueProcessing(deferredDependencies);
  };
}

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

function queueDependencies(input: StorageGateway | AutomaticMemoryCaptureQueueDependencies): {
  storage: StorageGateway;
  llm: LlmGateway | null;
} {
  if ("storage" in input && "llm" in input) return input;
  return { storage: input, llm: null };
}

function jobScope(job: JsonRecord): MemoryScope | null {
  const kind = readString(job.scopeKind).trim();
  const id = readString(job.scopeId).trim();
  if (!["character", "chat", "scene"].includes(kind) || !id) return null;
  return { kind: kind as MemoryScope["kind"], id };
}

async function eligibleCanonicalMemories(
  storage: StorageGateway,
  scope: MemoryScope,
): Promise<CanonicalMemoryRecord[]> {
  if (!storage.queryMemories) return [];
  const memories = await storage.queryMemories({ scope, statuses: ["active", "pinned"] });
  return memories
    .filter(canonicalMemoryEligibleForConsequences)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 24);
}

async function extractAndPersistConsequences(args: {
  storage: StorageGateway;
  llm: LlmGateway;
  job: JsonRecord;
  now: string;
}): Promise<PersistedCanonicalConsequence[]> {
  const scope = jobScope(args.job);
  const jobId = readString(args.job.id).trim();
  const chatId = readString(args.job.chatId).trim();
  const sourceMessages = sourceSnapshotsFromJob(args.job);
  if (!scope || !jobId || !chatId || sourceMessages.length === 0) return [];
  const eligibleMemories = await eligibleCanonicalMemories(args.storage, scope);
  const extraction = await extractCanonicalMemoryConsequences({
    llm: args.llm,
    request: {
      version: 1,
      jobId,
      chatId,
      mode: readString(args.job.mode).trim() || "conversation",
      scope,
      activeCharacterId: readString(args.job.characterId).trim() || null,
      sourceMessages,
      eligibleMemories,
      connectionId: readString(args.job.connectionId).trim() || null,
      model: readString(args.job.model).trim() || null,
    },
  });
  const persisted = await persistCanonicalMemoryConsequences({
    storage: args.storage,
    candidates: extraction.candidates,
    eligibleMemories,
    now: args.now,
  });
  if (persisted.affected.length > 0 && args.storage.rebuildMemoryIndex) {
    try {
      await args.storage.rebuildMemoryIndex({ scope });
    } catch (error) {
      await updateJob(args.storage, jobId, {
        canonicalIndexError: errorMessage(error),
        canonicalIndexFailedAt: args.now,
        updatedAt: args.now,
      });
    }
  }
  return persisted.affected;
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
    connectionId: input.connectionId ?? null,
    model: input.model ?? null,
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
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
  options: AutomaticMemoryCaptureProcessOptions = {},
): Promise<{ processed: number; completed: number; retryable: number; failed: number; stale: number }> {
  const { storage, llm } = queueDependencies(dependencies);
  if (!storage.refreshChatMemories) return { processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };
  const now = options.now ?? nowIso();
  const jobs = await storage.list<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION).catch(() => []);
  const dueJobs = jobs
    .filter((job) => jobDue(job, now))
    .sort((left, right) => readString(left.createdAt).localeCompare(readString(right.createdAt)))
    .slice(0, options.limit ?? 10);
  const result = { processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };

  for (const job of dueJobs) {
    if (foregroundGenerationActive(storage)) {
      deferWorkerUntilForegroundCompletes(storage, dependencies);
      break;
    }
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
      const consequences = llm ? await extractAndPersistConsequences({ storage, llm, job, now }) : [];
      const consequenceStatus = llm ? "completed" : "skipped";
      const consequenceSkipReason = llm ? null : "llm_gateway_unavailable";
      const assistantMessageId = readString(job.assistantMessageId).trim();
      if (assistantMessageId) {
        await storage.patchChatMessageExtra(assistantMessageId, {
          memoryCapture: {
            status: "completed",
            jobId: id,
            sourceMessageIds,
            completedAt: now,
            ...(capture ? { capture } : {}),
            consequences: {
              status: consequenceStatus,
              ...(consequenceSkipReason ? { skipReason: consequenceSkipReason } : {}),
              affected: consequences.map(({ operation, memory }) => ({
                operation,
                memory: {
                  id: memory.id,
                  kind: memory.kind,
                  status: memory.status,
                  content: memory.content,
                },
              })),
            },
          },
        });
      }
      await updateJob(storage, id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
        lastError: null,
        nextAttemptAt: null,
        consequenceStatus,
        consequenceSkipReason,
        affectedCanonicalMemoryIds: consequences.map((entry) => entry.memory.id),
      });
      result.completed += 1;
      const completion = consequences[0];
      if (completion && assistantMessageId) {
        publishMemoryCaptureCompletion({
          chatId,
          assistantMessageId,
          operation: completion.operation === "created" ? "created" : "updated",
          memory: { id: completion.memory.id, content: completion.memory.content },
        });
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

export function scheduleAutomaticMemoryCaptureQueueProcessing(
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
): void {
  const { storage } = queueDependencies(dependencies);
  if (foregroundGenerationActive(storage)) {
    deferWorkerUntilForegroundCompletes(storage, dependencies);
    return;
  }
  if (activeWorkers.has(storage)) {
    pendingWorkerReruns.add(storage);
    return;
  }
  activeWorkers.add(storage);
  void processAutomaticMemoryCaptureQueue(dependencies).finally(() => {
    activeWorkers.delete(storage);
    if (pendingWorkerReruns.has(storage)) {
      pendingWorkerReruns.delete(storage);
      scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
    }
  });
}

export async function enqueueAndScheduleAutomaticMemoryCapture(
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
  input: AutomaticMemoryCaptureScheduleInput,
): Promise<JsonRecord | null> {
  const { storage } = queueDependencies(dependencies);
  const job = await enqueueAutomaticMemoryCaptureJob(storage, input);
  if (job) scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
  return job;
}
