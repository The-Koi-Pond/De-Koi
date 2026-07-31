import type { StorageGateway } from "../capabilities/storage";
import {
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
} from "./background-generation-coordinator";

export type CraftAnalysisStage = "narrative_craft_analysis" | "conversation_craft_analysis";

export interface CraftAnalysisDiagnostic {
  stage: CraftAnalysisStage;
  status: "ok" | "error";
  durationMs: number;
}

export interface ScheduleCraftAnalysisInput {
  storage: StorageGateway;
  chatId: string;
  stage: CraftAnalysisStage;
  run: (signal: AbortSignal) => Promise<void>;
  onDiagnostic?: (diagnostic: CraftAnalysisDiagnostic) => void;
  now?: () => number;
}

interface CraftAnalysisJob {
  stage: CraftAnalysisStage;
  run: (signal: AbortSignal) => Promise<void>;
  onDiagnostic?: (diagnostic: CraftAnalysisDiagnostic) => void;
  now: () => number;
}

interface ScheduledCraftAnalysis {
  pendingJob: CraftAnalysisJob | null;
  controller: AbortController | null;
  cancelled: boolean;
}

const scheduledByStorage = new WeakMap<StorageGateway, Map<string, ScheduledCraftAnalysis>>();

function jobFor(input: ScheduleCraftAnalysisInput): CraftAnalysisJob {
  return { stage: input.stage, run: input.run, onDiagnostic: input.onDiagnostic, now: input.now ?? Date.now };
}

function reportDiagnostic(job: CraftAnalysisJob, status: CraftAnalysisDiagnostic["status"], startedAt: number): void {
  if (!job.onDiagnostic) return;
  try {
    const elapsed = job.now() - startedAt;
    job.onDiagnostic({
      stage: job.stage,
      status,
      durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
    });
  } catch {
    // Optional diagnostics must not affect background work or queue progress.
  }
}

export function scheduleCraftAnalysis(input: ScheduleCraftAnalysisInput): boolean {
  const chatId = input.chatId.trim();
  if (!chatId) return false;
  const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, ScheduledCraftAnalysis>();
  scheduledByStorage.set(input.storage, scheduled);
  const active = scheduled.get(chatId);
  if (active) {
    active.pendingJob = jobFor(input);
    return true;
  }

  const state: ScheduledCraftAnalysis = { pendingJob: null, controller: null, cancelled: false };
  scheduled.set(chatId, state);
  const initialJob = jobFor(input);
  setTimeout(() => startOrDefer(input.storage, chatId, initialJob, state, scheduled), 0);
  return true;
}

function startOrDefer(
  storage: StorageGateway,
  chatId: string,
  initialJob: CraftAnalysisJob,
  state: ScheduledCraftAnalysis,
  scheduled: Map<string, ScheduledCraftAnalysis>,
): void {
  if (state.cancelled || scheduled.get(chatId) !== state) return;
  if (foregroundGenerationActive(storage)) {
    deferUntilForegroundGenerationCompletes(storage, state, () => {
      startOrDefer(storage, chatId, initialJob, state, scheduled);
    });
    return;
  }
  void runScheduled(storage, chatId, initialJob, state, scheduled);
}

export function cancelCraftAnalysis(storage: StorageGateway, chatId: string): void {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) return;
  const scheduled = scheduledByStorage.get(storage);
  const active = scheduled?.get(normalizedChatId);
  if (!active) return;
  active.cancelled = true;
  active.pendingJob = null;
  active.controller?.abort();
  scheduled?.delete(normalizedChatId);
  if (scheduled?.size === 0) scheduledByStorage.delete(storage);
}

export function cancelCraftAnalysesForForeground(storage: StorageGateway): void {
  const scheduled = scheduledByStorage.get(storage);
  if (!scheduled) return;
  scheduledByStorage.delete(storage);
  for (const state of scheduled.values()) {
    state.cancelled = true;
    state.pendingJob = null;
    state.controller?.abort();
  }
  scheduled.clear();
}

function abortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

async function runScheduled(
  storage: StorageGateway,
  chatId: string,
  initialJob: CraftAnalysisJob,
  state: ScheduledCraftAnalysis,
  scheduled: Map<string, ScheduledCraftAnalysis>,
): Promise<void> {
  let job: CraftAnalysisJob | null = initialJob;
  try {
    while (job && !state.cancelled) {
      const startedAt = job.now();
      const controller = new AbortController();
      state.controller = controller;
      try {
        await job.run(controller.signal);
        reportDiagnostic(job, "ok", startedAt);
      } catch (error) {
        if (!controller.signal.aborted && !abortError(error)) {
          console.warn("[generation] craft background analysis failed", {
            chatId,
            stage: job.stage,
            error: error instanceof Error ? error.message : String(error ?? "Unknown craft analysis error"),
          });
          reportDiagnostic(job, "error", startedAt);
        }
      }
      state.controller = null;
      job = state.pendingJob;
      state.pendingJob = null;
    }
  } finally {
    state.controller = null;
    if (scheduled.get(chatId) === state) scheduled.delete(chatId);
    if (scheduled.size === 0) scheduledByStorage.delete(storage);
  }
}
