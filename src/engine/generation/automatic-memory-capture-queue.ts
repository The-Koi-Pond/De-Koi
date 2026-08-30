import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryRecord, MemoryScope } from "../contracts/types/memory";
import {
  canonicalMemoryEligibleForConsequences,
  extractCanonicalMemoryConsequences,
  persistCanonicalMemoryConsequences,
  reviewAutomaticMemoryCandidates,
  type PersistedCanonicalConsequence,
} from "./automatic-memory-capture";
import { buildAutomaticMemoryCaptureContext, type AutomaticMemorySourceMessage } from "./automatic-memory-context";
import { resolveAutomaticMemoryScope, type CharacterMemoryScopeCharacter } from "./character-memory-scope";
import { nowIso, parseArray, parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";
import {
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
} from "./background-generation-coordinator";
import { resolveBackgroundTextConnection } from "./background-llm-connection";
import { isTerminalBackgroundGenerationError } from "./background-generation-error";
import { wakeAutomaticMemoryMaintenanceQueueProcessing } from "./automatic-memory-maintenance-queue";
import { legacyMemoryId, sha256MemoryId } from "./deterministic-memory-id";
import { knowledgeEdgesForCapturedMemory } from "./automatic-memory-knowledge";

export { beginForegroundGeneration } from "./background-generation-coordinator";

const MEMORY_CAPTURE_JOBS_COLLECTION: StorageEntity = "memory-capture-jobs";
const AUTOMATIC_MEMORY_CAPTURE_VERSION = 2;
const MAX_CAPTURE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const CAPTURE_LEASE_TTL_MS = 30_000;
const CAPTURE_LEASE_HEARTBEAT_MS = 10_000;
const CAPTURE_LEASE_REQUEST_TIMEOUT_MS = 5_000;
const automaticCaptureWorkerId = `automatic-memory-capture-${
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}`;

type MemoryCaptureJobStatus = "pending" | "processing" | "retryable" | "completed" | "failed" | "stale";

interface MemoryCaptureJob extends JsonRecord {
  id: string;
  status: MemoryCaptureJobStatus;
  chatId: string;
  sourceChatId: string;
  sourceMessageIds: string[];
  sourceMessages: AutomaticMemorySourceMessage[];
  referenceMessageIds: string[];
  referenceMessages: AutomaticMemorySourceMessage[];
  userLabel: string;
  characterLabels: Record<string, string>;
  assistantMessageId: string;
  userMessageId?: string | null;
  mode?: string | null;
  scopeType: "chat";
  scopeKind: "character" | "chat" | "scene";
  scopeId: string;
  scopeReason: "attributed_character" | "character_chat_only" | "ambiguous_scene" | "ambiguous_chat";
  characterId?: string | null;
  sceneId?: string | null;
  personaId?: string | null;
  participantCharacterIds: string[];
  connectionId?: string | null;
  model?: string | null;
  captureVersion: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: string | null;
  leaseExpiresAt?: string | null;
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
  workerId?: string;
  leaseHeartbeatMs?: number;
  leaseRequestTimeoutMs?: number;
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

export interface AutomaticMemoryCaptureStatus {
  chatId: string;
  assistantMessageId: string;
  status: "processing" | "retryable" | "failed" | "completed";
}

type AutomaticMemoryCaptureCompletionListener = (completion: AutomaticMemoryCaptureCompletion) => void;
type AutomaticMemoryCaptureStatusListener = (status: AutomaticMemoryCaptureStatus) => void;

const completionListeners = new Set<AutomaticMemoryCaptureCompletionListener>();
const statusListeners = new Set<AutomaticMemoryCaptureStatusListener>();

export function subscribeAutomaticMemoryCaptureCompletions(
  listener: AutomaticMemoryCaptureCompletionListener,
): () => void {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

export function subscribeAutomaticMemoryCaptureStatuses(listener: AutomaticMemoryCaptureStatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function memoryCaptureFromCommit(
  value: unknown,
): Omit<AutomaticMemoryCaptureCompletion, "chatId" | "assistantMessageId"> | null {
  const capture = parseRecord(value);
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

function publishMemoryCaptureStatus(status: AutomaticMemoryCaptureStatus): void {
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch {
      // UI observers cannot invalidate a lifecycle state that is already durable.
    }
  }
}

const activeWorkers = new WeakSet<StorageGateway>();
const pendingWorkerReruns = new WeakSet<StorageGateway>();
const scheduledWorkerTimers = new WeakMap<StorageGateway, ReturnType<typeof setTimeout>>();
const captureWorkerKey = {};

function deferWorkerUntilForegroundCompletes(
  storage: StorageGateway,
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
): void {
  deferUntilForegroundGenerationCompletes(storage, captureWorkerKey, () => {
    scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
  });
}

function jobIdentity(chatId: string, sourceMessageIds: string[]): string {
  return `${AUTOMATIC_MEMORY_CAPTURE_VERSION}\u001f${chatId}\u001f${sourceMessageIds.join("\u001f")}`;
}

async function jobIdFor(chatId: string, sourceMessageIds: string[]): Promise<string> {
  return sha256MemoryId("memory-capture", jobIdentity(chatId, sourceMessageIds));
}

function legacyJobIdFor(chatId: string, sourceMessageIds: string[]): string {
  return legacyMemoryId("memory-capture", jobIdentity(chatId, sourceMessageIds));
}

function jobMatchesIdentity(job: JsonRecord, chatId: string, sourceMessageIds: string[]): boolean {
  return (
    readNumber(job.captureVersion, 0) === AUTOMATIC_MEMORY_CAPTURE_VERSION &&
    readString(job.chatId).trim() === chatId &&
    JSON.stringify(parseArray(job.sourceMessageIds).map((value) => readString(value).trim())) ===
      JSON.stringify(sourceMessageIds)
  );
}

function sourceSnapshot(value: unknown): AutomaticMemorySourceMessage | null {
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
    speakerLabel: readString(record.speakerLabel).trim(),
  };
}

function sourceSnapshotsFromJob(job: JsonRecord): AutomaticMemorySourceMessage[] {
  return parseArray(job.sourceMessages)
    .map((value) => sourceSnapshot(value))
    .filter((value): value is AutomaticMemorySourceMessage => value !== null);
}

function referenceSnapshotsFromJob(job: JsonRecord): AutomaticMemorySourceMessage[] {
  return parseArray(job.referenceMessages)
    .map((value) => sourceSnapshot(value))
    .filter((value): value is AutomaticMemorySourceMessage => value !== null);
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
  if (status === "pending") return true;
  if (status === "processing") {
    const leaseExpiresAt = readString(job.leaseExpiresAt).trim();
    return !leaseExpiresAt || leaseExpiresAt <= now;
  }
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

async function updateJob(
  storage: StorageGateway,
  id: string,
  patch: Record<string, unknown>,
  leaseId?: string,
): Promise<JsonRecord> {
  if (leaseId) {
    if (!storage.updateMemoryCaptureJob) throw new Error("Automatic memory capture lease API is unavailable");
    return (await storage.updateMemoryCaptureJob(leaseId, id, patch)) as JsonRecord;
  }
  return storage.update<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, id, patch);
}

async function patchMemoryCaptureStatus(
  storage: StorageGateway,
  job: JsonRecord,
  status: AutomaticMemoryCaptureStatus["status"],
  memoryCapture: Record<string, unknown>,
  leaseId?: string,
): Promise<void> {
  const assistantMessageId = readString(job.assistantMessageId).trim();
  const chatId = readString(job.chatId).trim();
  if (!assistantMessageId || !chatId) return;
  if (leaseId) {
    if (!storage.patchMemoryCaptureMessageExtra) throw new Error("Automatic memory capture lease API is unavailable");
    await storage.patchMemoryCaptureMessageExtra(leaseId, assistantMessageId, { memoryCapture });
  } else {
    await storage.patchChatMessageExtra(assistantMessageId, { memoryCapture });
  }
  publishMemoryCaptureStatus({ chatId, assistantMessageId, status });
}

function boundedLeaseRequest<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Automatic memory capture lease request timed out")), timeoutMs);
    void request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function validateSourceMessages(storage: StorageGateway, job: JsonRecord): Promise<string | null> {
  const snapshots = [...sourceSnapshotsFromJob(job), ...referenceSnapshotsFromJob(job)];
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

async function extractConsequences(args: {
  storage: StorageGateway;
  llm: LlmGateway;
  job: JsonRecord;
  connectionId: string;
  model: string | null;
}): Promise<{
  scope: MemoryScope;
  candidates: Awaited<ReturnType<typeof extractCanonicalMemoryConsequences>>["candidates"];
  eligibleMemories: CanonicalMemoryRecord[];
}> {
  const scope = jobScope(args.job);
  const jobId = readString(args.job.id).trim();
  const chatId = readString(args.job.chatId).trim();
  const sourceMessages = sourceSnapshotsFromJob(args.job);
  const referenceMessages = referenceSnapshotsFromJob(args.job);
  if (!scope || !jobId || !chatId || sourceMessages.length === 0) {
    throw new Error("Automatic memory capture job is incomplete");
  }
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
      userLabel: readString(args.job.userLabel).trim() || "{{user}}",
      characterLabels: parseRecord(args.job.characterLabels) as Record<string, string>,
      sourceMessages,
      referenceMessages,
      eligibleMemories,
      connectionId: args.connectionId,
      model: args.model,
    },
  });
  return { scope, candidates: extraction.candidates, eligibleMemories };
}

export async function enqueueAutomaticMemoryCaptureJob(
  storage: StorageGateway,
  input: AutomaticMemoryCaptureScheduleInput,
  now = nowIso(),
): Promise<JsonRecord | null> {
  const chat = input.chat;
  const captureContext = await buildAutomaticMemoryCaptureContext(storage, input);
  if (!captureContext) return null;
  const { userLabel, characterLabels, sourceMessages, referenceMessages } = captureContext;
  const assistant = sourceMessages.at(-1);
  if (!assistant || assistant.role !== "assistant") return null;
  const user = sourceMessages.find((message) => message.role === "user");
  const sourceMessageIds = sourceMessages.map((message) => message.id);
  const referenceMessageIds = referenceMessages.map((message) => message.id);
  const chatId = readString(chat.id).trim() || assistant.chatId;
  if (!chatId || sourceMessageIds.length === 0) return null;
  const mode = readString(chat.mode || chat.chatMode).trim();
  const metadata = parseRecord(chat.metadata);
  const formalScene =
    mode === "roleplay" &&
    Boolean(
      readString(metadata.sceneOriginChatId).trim() ||
        readString(metadata.sceneStatus).trim() ||
        readString(chat.sceneId).trim(),
    );
  const sceneId =
    readString(chat.sceneId || chat.activeSceneId).trim() || (formalScene ? chatId : null);
  const resolvedScope = resolveAutomaticMemoryScope({
    chatId,
    mode,
    sceneId,
    assistantCharacterId: assistant.characterId,
    activeCharacters: input.characters,
  });

  let id = await jobIdFor(chatId, sourceMessageIds);
  let existing = await storage.get<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, id).catch(() => null);
  if (existing && !jobMatchesIdentity(existing, chatId, sourceMessageIds)) {
    throw new Error("Automatic memory capture SHA-256 job id collision");
  }
  if (!existing) {
    const legacyId = legacyJobIdFor(chatId, sourceMessageIds);
    const legacy = await storage.get<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION, legacyId).catch(() => null);
    if (legacy && jobMatchesIdentity(legacy, chatId, sourceMessageIds)) {
      id = legacyId;
      existing = legacy;
    }
  }
  const base: MemoryCaptureJob = {
    id,
    status: "pending",
    chatId,
    sourceChatId: chatId,
    sourceMessageIds,
    sourceMessages,
    referenceMessageIds,
    referenceMessages,
    userLabel,
    characterLabels,
    assistantMessageId: assistant.id,
    userMessageId: user?.id ?? null,
    mode: mode || null,
    scopeType: "chat",
    scopeKind: resolvedScope.scope.kind,
    scopeId: resolvedScope.scope.id,
    scopeReason: resolvedScope.reason,
    characterId: resolvedScope.characterId,
    sceneId,
    personaId: readString(chat.personaId).trim() || null,
    participantCharacterIds: formalScene
      ? Array.from(new Set(input.characters.map((character) => character.id.trim()).filter(Boolean)))
      : [],
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
): Promise<{
  leaseAcquired: boolean;
  processed: number;
  completed: number;
  retryable: number;
  failed: number;
  stale: number;
}> {
  const { storage, llm } = queueDependencies(dependencies);
  const now = options.now ?? nowIso();
  const result = { leaseAcquired: false, processed: 0, completed: 0, retryable: 0, failed: 0, stale: 0 };
  if (
    !storage.acquireMemoryCaptureWorker ||
    !storage.releaseMemoryCaptureWorker ||
    !storage.updateMemoryCaptureJob ||
    !storage.createMemoryCaptureMemory ||
    !storage.updateMemoryCaptureMemory ||
    !storage.patchMemoryCaptureMessageExtra ||
    !storage.rebuildMemoryCaptureIndex
  ) {
    return result;
  }
  const workerId = options.workerId ?? automaticCaptureWorkerId;
  const leaseId = await storage.acquireMemoryCaptureWorker(workerId);
  if (!leaseId) return result;
  result.leaseAcquired = true;
  let leaseLost = false;
  let leaseRenewal: Promise<void> | null = null;
  const leaseRequestTimeoutMs = Math.max(1, options.leaseRequestTimeoutMs ?? CAPTURE_LEASE_REQUEST_TIMEOUT_MS);
  const renewLease = () => {
    if (leaseRenewal || leaseLost) return;
    leaseRenewal = boundedLeaseRequest(storage.acquireMemoryCaptureWorker!(workerId, leaseId), leaseRequestTimeoutMs)
      .then((renewed) => {
        if (renewed !== leaseId) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        leaseRenewal = null;
      });
  };
  const requireLease = async () => {
    if (leaseRenewal) await leaseRenewal;
    if (
      leaseLost ||
      (await boundedLeaseRequest(storage.acquireMemoryCaptureWorker!(workerId, leaseId), leaseRequestTimeoutMs)) !==
        leaseId
    ) {
      leaseLost = true;
      throw new Error("Automatic memory capture lease was lost");
    }
  };
  const heartbeat = setInterval(renewLease, Math.max(1, options.leaseHeartbeatMs ?? CAPTURE_LEASE_HEARTBEAT_MS));
  try {
    const jobs = await storage.list<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION);
    const dueJobs = jobs
      .filter((job) => jobDue(job, now))
      .sort((left, right) => readString(left.createdAt).localeCompare(readString(right.createdAt)))
      .slice(0, options.limit ?? 10);

    for (const job of dueJobs) {
      if (leaseLost) break;
      await requireLease();
      if (foregroundGenerationActive(storage)) {
        deferWorkerUntilForegroundCompletes(storage, dependencies);
        break;
      }
      const id = readString(job.id).trim();
      if (!id) continue;
      const attempts = readNumber(job.attempts, 0) + 1;
      const maxAttempts = Math.max(1, readNumber(job.maxAttempts, MAX_CAPTURE_ATTEMPTS));
      result.processed += 1;
      await updateJob(
        storage,
        id,
        {
          status: "processing",
          attempts,
          startedAt: now,
          leaseExpiresAt: new Date(Date.parse(now) + CAPTURE_LEASE_TTL_MS).toISOString(),
          updatedAt: now,
          lastError: null,
        },
        leaseId,
      );

      try {
        await patchMemoryCaptureStatus(storage, job, "processing", {
          status: "processing",
          jobId: id,
          sourceMessageIds: jobSourceIds(job),
          attempts,
          updatedAt: now,
        }, leaseId);
        const staleReason = await validateSourceMessages(storage, job);
        if (staleReason) {
          await updateJob(
            storage,
            id,
            {
              status: "stale",
              staleReason,
              completedAt: now,
              updatedAt: now,
            },
            leaseId,
          );
          await patchMemoryCaptureStatus(storage, job, "failed", {
            status: "failed",
            jobId: id,
            sourceMessageIds: jobSourceIds(job),
            attempts,
            failureCategory: "capture_unavailable",
            updatedAt: now,
          }, leaseId).catch(() => {});
          result.stale += 1;
          continue;
        }

        const sourceMessageIds = jobSourceIds(job);
        const chatId = readString(job.chatId).trim();
        if (!llm) throw new Error("Automatic memory value review requires an LLM gateway");
        const queuedConnectionId = readString(job.connectionId).trim();
        const queuedModel = readString(job.model).trim();
        const backgroundConnection = await resolveBackgroundTextConnection(storage, queuedConnectionId, queuedModel);
        const connectionId = readString(backgroundConnection.id).trim();
        const model =
          readString(backgroundConnection.model).trim() ||
          (connectionId === queuedConnectionId ? queuedModel : "") ||
          null;
        if (!storage.previewChatMemoryCapture || !storage.commitChatMemoryCapture) {
          throw new Error("Automatic memory capture requires a two-phase storage runtime");
        }
        const preview = await storage.previewChatMemoryCapture(chatId, sourceMessageIds);
        const extracted = await extractConsequences({ storage, llm, job, connectionId, model });
        const valueGate = await reviewAutomaticMemoryCandidates({
          llm,
          connectionId,
          jobId: id,
          scope: extracted.scope,
          transcriptCandidate: preview.candidate,
          canonicalCandidates: extracted.candidates,
        });
        await requireLease();
        const persisted = await persistCanonicalMemoryConsequences({
          storage,
          candidates: valueGate.acceptedCanonicalCandidates,
          eligibleMemories: extracted.eligibleMemories,
          now,
          knowledgeEdgesForMemory: (candidate, memoryId) =>
            knowledgeEdgesForCapturedMemory({
              memoryId,
              memoryKind: candidate.kind,
              scopeReason: readString(job.scopeReason).trim() as MemoryCaptureJob["scopeReason"],
              characterId: readString(job.characterId).trim() || null,
              personaId: readString(job.personaId).trim() || null,
              sceneId: readString(job.sceneId).trim() || null,
              participantCharacterIds: parseArray(job.participantCharacterIds)
                .map((id) => readString(id).trim())
                .filter(Boolean),
              sourceChatId: chatId,
              sourceMessageIds,
              now,
            }),
          createMemory: (body, knowledgeEdges) =>
            storage.createMemoryCaptureMemory!(leaseId, body, knowledgeEdges),
          updateMemory: (memoryId, patch, knowledgeEdges) =>
            storage.updateMemoryCaptureMemory!(leaseId, memoryId, patch, knowledgeEdges),
        });
        const consequences: PersistedCanonicalConsequence[] = persisted.affected;
        if (consequences.length > 0) {
          try {
            await storage.rebuildMemoryCaptureIndex(leaseId, { scope: extracted.scope });
          } catch (error) {
            await updateJob(
              storage,
              id,
              {
                canonicalIndexError: errorMessage(error),
                canonicalIndexFailedAt: now,
                updatedAt: now,
              },
              leaseId,
            );
          }
        }
        await requireLease();
        const committedCapture = valueGate.acceptTranscriptCandidate
          ? await storage.commitChatMemoryCapture({
              version: 1,
              chatId: preview.chatId,
              sourceMessageIds: preview.sourceMessageIds,
              fingerprint: preview.fingerprint,
              leaseId,
            })
          : null;
        const capture = committedCapture ? memoryCaptureFromCommit(committedCapture) : null;
        const reviewedCandidateCount = (preview.candidate ? 1 : 0) + extracted.candidates.length;
        const valueReview = {
          status: "completed",
          reviewed: reviewedCandidateCount,
          rejected: valueGate.rejectedCandidateCount,
          accepted: reviewedCandidateCount - valueGate.rejectedCandidateCount,
        };
        const assistantMessageId = readString(job.assistantMessageId).trim();
        await requireLease();
        if (assistantMessageId) {
          await storage.patchMemoryCaptureMessageExtra(leaseId, assistantMessageId, {
            memoryCapture: {
              status: "completed",
              jobId: id,
              sourceMessageIds,
              completedAt: now,
              ...(capture ? { capture } : {}),
              valueReview,
              consequences: {
                status: "completed",
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
          publishMemoryCaptureStatus({ chatId, assistantMessageId, status: "completed" });
        }
        await updateJob(
          storage,
          id,
          {
            status: "completed",
            completedAt: now,
            updatedAt: now,
            leaseExpiresAt: null,
            lastError: null,
            nextAttemptAt: null,
            consequenceStatus: "completed",
            consequenceSkipReason: null,
            valueReview,
            affectedCanonicalMemoryIds: consequences.map((entry) => entry.memory.id),
          },
          leaseId,
        );
        wakeAutomaticMemoryMaintenanceQueueProcessing(storage);
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
        const configurationFailure = isTerminalBackgroundGenerationError(error);
        const terminal = configurationFailure || attempts >= maxAttempts;
        const nextAttemptAt = terminal ? null : retryTime(now, attempts);
        await updateJob(
          storage,
          id,
          {
            status: terminal ? "failed" : "retryable",
            lastError: errorMessage(error),
            failedAt: terminal ? now : null,
            nextAttemptAt,
            leaseExpiresAt: null,
            updatedAt: now,
          },
          leaseId,
        );
        await patchMemoryCaptureStatus(storage, job, terminal ? "failed" : "retryable", {
          status: terminal ? "failed" : "retryable",
          jobId: id,
          sourceMessageIds: jobSourceIds(job),
          attempts,
          ...(terminal
            ? { failureCategory: configurationFailure ? "configuration_error" : "capture_unavailable" }
            : { nextAttemptAt }),
          updatedAt: now,
        }, leaseId).catch(() => {});
        if (terminal) result.failed += 1;
        else result.retryable += 1;
      }
    }
    return result;
  } finally {
    clearInterval(heartbeat);
    await leaseRenewal;
    await boundedLeaseRequest(storage.releaseMemoryCaptureWorker(workerId, leaseId), leaseRequestTimeoutMs).catch(
      () => {},
    );
  }
}

function clearScheduledWorker(storage: StorageGateway): void {
  const timer = scheduledWorkerTimers.get(storage);
  if (timer === undefined) return;
  clearTimeout(timer);
  scheduledWorkerTimers.delete(storage);
}

async function scheduleNextAutomaticMemoryCaptureQueuePass(
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
  minimumDelayMs = 0,
): Promise<void> {
  const { storage } = queueDependencies(dependencies);
  if (foregroundGenerationActive(storage)) {
    deferWorkerUntilForegroundCompletes(storage, dependencies);
    return;
  }

  let jobs: JsonRecord[];
  try {
    jobs = await storage.list<JsonRecord>(MEMORY_CAPTURE_JOBS_COLLECTION);
  } catch {
    clearScheduledWorker(storage);
    const timer = setTimeout(() => {
      scheduledWorkerTimers.delete(storage);
      scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
    }, RETRY_BACKOFF_MS[0]);
    scheduledWorkerTimers.set(storage, timer);
    return;
  }
  const now = Date.now();
  const earliestRunAt = now + minimumDelayMs;
  let nextRunAt: number | null = null;
  for (const job of jobs) {
    const status = jobStatus(job);
    if (status === "pending") {
      nextRunAt = earliestRunAt;
      break;
    }
    if (status === "processing") {
      const parsed = Date.parse(readString(job.leaseExpiresAt).trim());
      const runAt = Number.isFinite(parsed) && parsed > now ? parsed : now + CAPTURE_LEASE_HEARTBEAT_MS;
      nextRunAt = nextRunAt === null ? runAt : Math.min(nextRunAt, runAt);
      continue;
    }
    if (status !== "retryable") continue;
    const parsed = Date.parse(readString(job.nextAttemptAt).trim());
    const runAt = Number.isFinite(parsed) ? parsed : now;
    nextRunAt = nextRunAt === null ? runAt : Math.min(nextRunAt, runAt);
  }
  if (nextRunAt === null) return;

  clearScheduledWorker(storage);
  const delay = Math.max(0, nextRunAt - now);
  const timer = setTimeout(() => {
    scheduledWorkerTimers.delete(storage);
    scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
  }, delay);
  scheduledWorkerTimers.set(storage, timer);
}

export function scheduleAutomaticMemoryCaptureQueueProcessing(
  dependencies: StorageGateway | AutomaticMemoryCaptureQueueDependencies,
): void {
  const { storage } = queueDependencies(dependencies);
  clearScheduledWorker(storage);
  if (
    !storage.acquireMemoryCaptureWorker ||
    !storage.releaseMemoryCaptureWorker ||
    !storage.updateMemoryCaptureJob ||
    !storage.createMemoryCaptureMemory ||
    !storage.updateMemoryCaptureMemory ||
    !storage.patchMemoryCaptureMessageExtra ||
    !storage.rebuildMemoryCaptureIndex
  ) {
    return;
  }
  if (foregroundGenerationActive(storage)) {
    deferWorkerUntilForegroundCompletes(storage, dependencies);
    return;
  }
  if (activeWorkers.has(storage)) {
    pendingWorkerReruns.add(storage);
    return;
  }
  activeWorkers.add(storage);
  let minimumDelayMs = 0;
  void processAutomaticMemoryCaptureQueue(dependencies)
    .then((result) => {
      if (!result.leaseAcquired) minimumDelayMs = CAPTURE_LEASE_HEARTBEAT_MS;
    })
    .catch(() => undefined)
    .finally(() => {
      activeWorkers.delete(storage);
      if (pendingWorkerReruns.has(storage)) {
        pendingWorkerReruns.delete(storage);
        scheduleAutomaticMemoryCaptureQueueProcessing(dependencies);
        return;
      }
      void scheduleNextAutomaticMemoryCaptureQueuePass(dependencies, minimumDelayMs);
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
