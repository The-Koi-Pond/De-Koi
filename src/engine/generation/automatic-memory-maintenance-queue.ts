import type { LlmGateway } from "../capabilities/llm";
import type { MemoryMaintenanceGateway } from "../capabilities/memory-maintenance";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { ChatMemoryChunk } from "../contracts/types/chat";
import type {
  MemoryCleanupApplyResult,
  MemoryCleanupProposal,
  MemoryCleanupSource,
  MemoryCleanupTarget,
} from "../contracts/types/memory-maintenance";
import {
  canonicalMemoryCleanupSource,
  chatMemoryCleanupSource,
  memoryScope,
} from "../entities/memory-maintenance-sources";
import {
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
} from "./background-generation-coordinator";
import { analyzeMemoryCleanup } from "./memory-cleanup";
import { nowIso, parseArray, parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";

const JOBS_COLLECTION: StorageEntity = "memory-maintenance-jobs";
const MAX_MAINTENANCE_ATTEMPTS = 3;
const MAX_PASSES_PER_DRAIN = 3;
const MAX_TOTAL_PASSES = 12;
const HEARTBEAT_MS = 30_000;
const MAINTENANCE_POLICY_VERSION = 1;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

export interface AutomaticMemoryMaintenanceDependencies {
  storage: StorageGateway;
  llm: LlmGateway;
  maintenance: MemoryMaintenanceGateway;
  resolveConnectionId(target: MemoryCleanupTarget): Promise<string>;
}

export interface AutomaticMemoryMaintenanceProcessOptions {
  now?: string;
  limit?: number;
}

export interface AutomaticMemoryMaintenanceResult {
  processed: number;
  completed: number;
  retryable: number;
  failed: number;
  applied: number;
}

class ForegroundPause extends Error {}

const activeWorkers = new WeakSet<StorageGateway>();
const pendingWorkerReruns = new WeakSet<StorageGateway>();
const cancelledWorkers = new WeakSet<StorageGateway>();
const scheduledWorkerTimers = new WeakMap<StorageGateway, ReturnType<typeof setTimeout>>();
const registeredDependencies = new WeakMap<StorageGateway, AutomaticMemoryMaintenanceDependencies>();
const maintenanceWorkerKey = {};

function targetFromJob(job: JsonRecord): MemoryCleanupTarget | null {
  const target = parseRecord(job.target);
  const scope = parseRecord(target.scope);
  const store = readString(target.store).trim();
  const kind = readString(scope.kind).trim();
  const id = readString(scope.id).trim();
  if (!["chat", "canonical"].includes(store) || !["chat", "scene", "character"].includes(kind) || !id) {
    return null;
  }
  return {
    store: store as MemoryCleanupTarget["store"],
    scope: { kind: kind as MemoryCleanupTarget["scope"]["kind"], id },
  };
}

function jobDue(job: JsonRecord, now: string): boolean {
  const status = readString(job.status).trim();
  if (status === "pending" || status === "processing") return true;
  if (status !== "retryable") return false;
  const nextAttemptAt = readString(job.nextAttemptAt).trim();
  return !nextAttemptAt || nextAttemptAt <= now;
}

function retryTime(now: string, attempts: number): string {
  const delay = RETRY_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)];
  const parsed = Date.parse(now);
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + delay).toISOString();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function targetKey(target: MemoryCleanupTarget): string {
  return `${target.store}:${target.scope.kind}:${target.scope.id}`;
}

function maintenanceJobId(target: MemoryCleanupTarget): string {
  return `memory-maintenance-${stableHash(`${MAINTENANCE_POLICY_VERSION}:${targetKey(target)}`)}`;
}

export async function enqueueAutomaticMemoryMaintenanceTarget(
  storage: StorageGateway,
  target: MemoryCleanupTarget,
  now = nowIso(),
): Promise<JsonRecord> {
  const id = maintenanceJobId(target);
  const key = targetKey(target);
  const existing = await storage.get<JsonRecord>(JOBS_COLLECTION, id).catch(() => null);
  if (existing) {
    if (readString(existing.targetKey).trim() !== key) {
      throw new Error("Memory maintenance job id collision");
    }
    if (readString(existing.status).trim() === "processing") {
      return storage.update<JsonRecord>(JOBS_COLLECTION, id, {
        dirty: true,
        trigger: "startup",
        updatedAt: now,
      });
    }
    if (readString(existing.status).trim() === "suppressed") return existing;
    return storage.update<JsonRecord>(JOBS_COLLECTION, id, {
      status: "pending",
      dirty: false,
      trigger: "startup",
      attempts: 0,
      totalPasses: 0,
      recentFingerprints: [],
      nextAttemptAt: now,
      lastBatchId: null,
      lastResult: null,
      updatedAt: now,
    });
  }
  return storage.create<JsonRecord>(JOBS_COLLECTION, {
    id,
    targetKey: key,
    target,
    policyVersion: MAINTENANCE_POLICY_VERSION,
    status: "pending",
    dirty: false,
    trigger: "startup",
    attempts: 0,
    maxAttempts: MAX_MAINTENANCE_ATTEMPTS,
    totalPasses: 0,
    recentFingerprints: [],
    nextAttemptAt: now,
    lastBatchId: null,
    lastResult: null,
    createdAt: now,
    updatedAt: now,
  });
}

function sourceFingerprint(sources: MemoryCleanupSource[]): string {
  const expected = sources
    .map((source) => ({
      id: source.id,
      content: source.content,
      status: source.status,
      updatedAt: source.updatedAt,
      pinned: source.pinned,
      userEdited: source.userEdited,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return stableHash(JSON.stringify(expected));
}

function eligibleSources(sources: MemoryCleanupSource[]): MemoryCleanupSource[] {
  return sources.filter(
    (source) =>
      Boolean(source.id && source.content.trim()) && (source.status === "active" || source.status === "pinned"),
  );
}

function scopeKey(scope: MemoryCleanupTarget["scope"]): string {
  return `${scope.kind}:${scope.id}`;
}

export async function loadAutomaticMemoryMaintenanceSources(
  storage: StorageGateway,
  target: MemoryCleanupTarget,
): Promise<MemoryCleanupSource[]> {
  if (target.store === "chat") {
    let chunks: ChatMemoryChunk[];
    try {
      chunks = await storage.listChatMemories<ChatMemoryChunk>(target.scope.id, { order: "stored" });
    } catch (error) {
      if (errorCode(error) === "not_found") return [];
      throw error;
    }
    if (target.scope.kind === "chat" && chunks.some((chunk) => chunk.scopeType === "scene")) {
      await enqueueAutomaticMemoryMaintenanceTarget(storage, {
        store: "chat",
        scope: { kind: "scene", id: target.scope.id },
      });
    }
    return chunks
      .filter((chunk) => {
        const kind = chunk.scopeType === "scene" ? "scene" : "chat";
        return kind === target.scope.kind && chunk.chatId === target.scope.id;
      })
      .map((chunk) => chatMemoryCleanupSource(chunk, target.scope))
      .filter((source) => scopeKey(source.scope) === scopeKey(target.scope));
  }
  if (!storage.queryMemories) throw new Error("Canonical memory queries are unavailable");
  return (await storage.queryMemories({ scope: memoryScope(target.scope), statuses: ["active", "pinned"] }))
    .map(canonicalMemoryCleanupSource)
    .filter((source) => scopeKey(source.scope) === scopeKey(target.scope));
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message = readString(record.message).toLowerCase();
    if (message.includes("changed after") || message.includes("stale state")) return "stale_state";
    const direct = readString(record.code).trim();
    if (direct) return direct;
    const body = parseRecord(record.body);
    const bodyCode = readString(body.code).trim();
    if (bodyCode) return bodyCode;
  }
  return "maintenance_failed";
}

function safeErrorMessage(code: string): string {
  if (code === "stale_state") return "Memory changed during automatic maintenance.";
  if (code === "unknown_command") return "Automatic memory maintenance is unavailable in this runtime.";
  return "Automatic memory maintenance could not finish.";
}

async function updateJob(storage: StorageGateway, id: string, patch: Record<string, unknown>): Promise<JsonRecord> {
  return storage.update<JsonRecord>(JOBS_COLLECTION, id, patch);
}

async function completeJob(
  storage: StorageGateway,
  id: string,
  now: string,
  lastResult: MemoryCleanupApplyResult | null,
  lastBatchId: string | null,
): Promise<"completed" | "pending"> {
  const current = await storage.get<JsonRecord>(JOBS_COLLECTION, id);
  if (current?.dirty === true) {
    await updateJob(storage, id, {
      status: "pending",
      dirty: false,
      attempts: 0,
      totalPasses: 0,
      recentFingerprints: [],
      nextAttemptAt: now,
      lastResult,
      lastBatchId,
      updatedAt: now,
    });
    return "pending";
  }
  await updateJob(storage, id, {
    status: "completed",
    dirty: false,
    nextAttemptAt: null,
    completedAt: now,
    lastResult,
    lastBatchId,
    lastError: null,
    lastErrorCode: null,
    updatedAt: now,
  });
  return "completed";
}

function deferWorker(dependencies: AutomaticMemoryMaintenanceDependencies): void {
  deferUntilForegroundGenerationCompletes(dependencies.storage, maintenanceWorkerKey, () =>
    scheduleAutomaticMemoryMaintenanceQueueProcessing(dependencies),
  );
}

export async function processAutomaticMemoryMaintenanceQueue(
  dependencies: AutomaticMemoryMaintenanceDependencies,
  options: AutomaticMemoryMaintenanceProcessOptions = {},
): Promise<AutomaticMemoryMaintenanceResult> {
  const now = options.now ?? nowIso();
  const result: AutomaticMemoryMaintenanceResult = {
    processed: 0,
    completed: 0,
    retryable: 0,
    failed: 0,
    applied: 0,
  };
  if (foregroundGenerationActive(dependencies.storage)) {
    deferWorker(dependencies);
    return result;
  }
  const jobs = await dependencies.storage.list<JsonRecord>(JOBS_COLLECTION).catch(() => []);
  const due = jobs
    .filter((job) => jobDue(job, now))
    .sort((left, right) => readString(left.createdAt).localeCompare(readString(right.createdAt)))
    .slice(0, options.limit ?? 10);

  for (const job of due) {
    if (foregroundGenerationActive(dependencies.storage)) {
      deferWorker(dependencies);
      break;
    }
    const id = readString(job.id).trim();
    const target = targetFromJob(job);
    if (!id || !target) continue;
    const attempts = readNumber(job.attempts, 0) + 1;
    const maxAttempts = Math.max(1, readNumber(job.maxAttempts, MAX_MAINTENANCE_ATTEMPTS));
    let totalPasses = Math.max(0, readNumber(job.totalPasses, 0));
    let recentFingerprints = parseArray(job.recentFingerprints)
      .map((value) => readString(value).trim())
      .filter(Boolean);
    let lastResult: MemoryCleanupApplyResult | null = null;
    let lastBatchId: string | null = readString(job.lastBatchId).trim() || null;
    result.processed += 1;
    await updateJob(dependencies.storage, id, {
      status: "processing",
      attempts,
      startedAt: now,
      updatedAt: now,
      lastError: null,
      lastErrorCode: null,
    });

    try {
      const connectionId = await dependencies.resolveConnectionId(target);
      if (!connectionId.trim()) throw new Error("No text connection is available");
      let settled = false;
      for (let pass = 0; pass < MAX_PASSES_PER_DRAIN; pass += 1) {
        if (foregroundGenerationActive(dependencies.storage)) throw new ForegroundPause();
        const sources = eligibleSources(await loadAutomaticMemoryMaintenanceSources(dependencies.storage, target));
        if (sources.length === 0) {
          settled = true;
          break;
        }
        const fingerprint = sourceFingerprint(sources);
        if (recentFingerprints.includes(fingerprint)) {
          await updateJob(dependencies.storage, id, {
            status: "failed",
            failedAt: now,
            nextAttemptAt: null,
            lastError: "Automatic memory maintenance stopped after repeated state.",
            lastErrorCode: "maintenance_oscillation",
            updatedAt: now,
          });
          result.failed += 1;
          settled = true;
          break;
        }
        recentFingerprints = [...recentFingerprints.slice(-5), fingerprint];
        const analysis = await analyzeMemoryCleanup({
          scope: target.scope,
          sources,
          connectionId,
          llm: dependencies.llm,
          onProgress: () => {
            if (foregroundGenerationActive(dependencies.storage)) throw new ForegroundPause();
          },
        });
        if (foregroundGenerationActive(dependencies.storage)) throw new ForegroundPause();
        const proposals: MemoryCleanupProposal[] = analysis.proposals
          .filter((proposal) => proposal.type !== "conflict")
          .map((proposal) => ({ ...proposal, selected: true }));
        if (proposals.length === 0) {
          settled = true;
          break;
        }
        lastResult = await dependencies.maintenance.apply({
          version: 2,
          target,
          proposals,
        });
        lastBatchId = lastResult.batchId;
        result.applied += 1;
        totalPasses += 1;
        await updateJob(dependencies.storage, id, {
          status: "processing",
          totalPasses,
          recentFingerprints,
          lastBatchId,
          lastResult,
          updatedAt: now,
        });
        if (totalPasses >= MAX_TOTAL_PASSES) {
          await updateJob(dependencies.storage, id, {
            status: "failed",
            failedAt: now,
            nextAttemptAt: null,
            lastError: "Automatic memory maintenance reached its pass limit.",
            lastErrorCode: "maintenance_pass_limit",
            updatedAt: now,
          });
          result.failed += 1;
          settled = true;
          break;
        }
      }
      const current = await dependencies.storage.get<JsonRecord>(JOBS_COLLECTION, id);
      if (readString(current?.status).trim() === "failed") continue;
      if (settled) {
        if ((await completeJob(dependencies.storage, id, now, lastResult, lastBatchId)) === "completed") {
          result.completed += 1;
        }
      } else {
        await updateJob(dependencies.storage, id, {
          status: "pending",
          attempts: 0,
          totalPasses,
          recentFingerprints,
          nextAttemptAt: now,
          lastResult,
          lastBatchId,
          updatedAt: now,
        });
      }
    } catch (error) {
      if (error instanceof ForegroundPause) {
        await updateJob(dependencies.storage, id, {
          status: "pending",
          attempts: Math.max(0, attempts - 1),
          nextAttemptAt: now,
          updatedAt: now,
        });
        deferWorker(dependencies);
        break;
      }
      const code = errorCode(error);
      const terminal = attempts >= maxAttempts;
      const nextAttemptAt = terminal ? null : retryTime(now, attempts);
      await updateJob(dependencies.storage, id, {
        status: terminal ? "failed" : "retryable",
        failedAt: terminal ? now : null,
        nextAttemptAt,
        lastError: safeErrorMessage(code),
        lastErrorCode: code,
        updatedAt: now,
      });
      if (terminal) result.failed += 1;
      else result.retryable += 1;
    }
  }
  return result;
}

function clearScheduledWorker(storage: StorageGateway): void {
  const timer = scheduledWorkerTimers.get(storage);
  if (timer === undefined) return;
  clearTimeout(timer);
  scheduledWorkerTimers.delete(storage);
}

export function cancelAutomaticMemoryMaintenanceQueueProcessing(storage: StorageGateway): void {
  cancelledWorkers.add(storage);
  pendingWorkerReruns.delete(storage);
  clearScheduledWorker(storage);
  registeredDependencies.delete(storage);
}

export function wakeAutomaticMemoryMaintenanceQueueProcessing(storage: StorageGateway): void {
  const dependencies = registeredDependencies.get(storage);
  if (dependencies) scheduleAutomaticMemoryMaintenanceQueueProcessing(dependencies);
}

async function scheduleNextPass(dependencies: AutomaticMemoryMaintenanceDependencies): Promise<void> {
  if (cancelledWorkers.has(dependencies.storage)) return;
  if (foregroundGenerationActive(dependencies.storage)) {
    deferWorker(dependencies);
    return;
  }
  const jobs = await dependencies.storage.list<JsonRecord>(JOBS_COLLECTION).catch(() => []);
  const now = Date.now();
  let delay = HEARTBEAT_MS;
  for (const job of jobs) {
    if (!targetFromJob(job)) continue;
    const status = readString(job.status).trim();
    if (status === "pending" || status === "processing") {
      delay = 0;
      break;
    }
    if (status !== "retryable") continue;
    const parsed = Date.parse(readString(job.nextAttemptAt).trim());
    delay = Math.min(delay, Math.max(0, (Number.isFinite(parsed) ? parsed : now) - now));
  }
  clearScheduledWorker(dependencies.storage);
  const timer = setTimeout(() => {
    scheduledWorkerTimers.delete(dependencies.storage);
    scheduleAutomaticMemoryMaintenanceQueueProcessing(dependencies);
  }, delay);
  scheduledWorkerTimers.set(dependencies.storage, timer);
}

export function scheduleAutomaticMemoryMaintenanceQueueProcessing(
  dependencies: AutomaticMemoryMaintenanceDependencies,
): void {
  cancelledWorkers.delete(dependencies.storage);
  registeredDependencies.set(dependencies.storage, dependencies);
  clearScheduledWorker(dependencies.storage);
  if (foregroundGenerationActive(dependencies.storage)) {
    deferWorker(dependencies);
    return;
  }
  if (activeWorkers.has(dependencies.storage)) {
    pendingWorkerReruns.add(dependencies.storage);
    return;
  }
  activeWorkers.add(dependencies.storage);
  void processAutomaticMemoryMaintenanceQueue(dependencies).finally(() => {
    activeWorkers.delete(dependencies.storage);
    if (cancelledWorkers.has(dependencies.storage)) return;
    if (pendingWorkerReruns.has(dependencies.storage)) {
      pendingWorkerReruns.delete(dependencies.storage);
      scheduleAutomaticMemoryMaintenanceQueueProcessing(dependencies);
      return;
    }
    void scheduleNextPass(dependencies);
  });
}
