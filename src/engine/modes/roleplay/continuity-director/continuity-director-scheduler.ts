import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { parseRecord, type JsonRecord } from "../../../generation/runtime-records";
import { refreshContinuityDirectorPlan } from "./continuity-director-planner";
import {
  decideContinuityDirectorRefresh,
  type ContinuityDirectorRefreshTrigger,
} from "./continuity-director-refresh-policy";
import { loadContinuityDirectorSource } from "./continuity-director-source";
import { normalizeContinuityDirectorState } from "./continuity-director-state";

export interface ContinuityDirectorRefreshDiagnostic {
  stage: "continuity_director_refresh";
  chatId: string;
  trigger: ContinuityDirectorRefreshTrigger;
  status: "skipped" | "ok" | "error";
  reason: string;
  rejectedUnsafeBeats?: number;
}

export interface ScheduleContinuityDirectorRefreshInput {
  storage: StorageGateway;
  llm: LlmGateway;
  chatId: string;
  trigger: ContinuityDirectorRefreshTrigger;
  onDiagnostic?: (diagnostic: ContinuityDirectorRefreshDiagnostic) => void;
}

export interface ContinuityDirectorRefreshScheduler {
  schedule(input: ScheduleContinuityDirectorRefreshInput): boolean;
  isPending(storage: StorageGateway, chatId: string): boolean;
}

interface SchedulerOverrides {
  defer?: (run: () => void) => void;
  loadSource?: typeof loadContinuityDirectorSource;
  refreshPlan?: typeof refreshContinuityDirectorPlan;
}

interface QueuedRefresh {
  input: ScheduleContinuityDirectorRefreshInput;
  nextTrigger: ContinuityDirectorRefreshTrigger | null;
}

function defaultDefer(run: () => void): void {
  setTimeout(run, 0);
}

function report(input: ScheduleContinuityDirectorRefreshInput, diagnostic: ContinuityDirectorRefreshDiagnostic): void {
  try {
    input.onDiagnostic?.(diagnostic);
  } catch {
    // Diagnostics must never affect queue progress or ordinary generation.
  }
  if (diagnostic.status === "error" && !input.onDiagnostic) {
    console.warn("[continuity-director] automatic refresh failed", diagnostic);
  }
}

export function createContinuityDirectorRefreshScheduler(
  overrides: SchedulerOverrides = {},
): ContinuityDirectorRefreshScheduler {
  const defer = overrides.defer ?? defaultDefer;
  const loadSource = overrides.loadSource ?? loadContinuityDirectorSource;
  const refreshPlan = overrides.refreshPlan ?? refreshContinuityDirectorPlan;
  const scheduledByStorage = new WeakMap<StorageGateway, Map<string, QueuedRefresh>>();

  async function runOne(job: QueuedRefresh, trigger: ContinuityDirectorRefreshTrigger): Promise<void> {
    const { storage, llm, chatId } = job.input;
    try {
      const chat = await storage.get<JsonRecord>("chats", chatId);
      if (!chat) throw new Error("Chat not found");
      const director = normalizeContinuityDirectorState(parseRecord(chat.metadata).roleplayContinuityDirector);
      const preflightReason = !director.enabled
        ? "disabled"
        : director.refreshMode === "manual"
          ? "manual"
          : director.refreshMode === "scene_events" && trigger === "assistant_saved"
            ? "trigger_mismatch"
            : director.refreshMode === "cadence" && trigger !== "assistant_saved"
              ? "trigger_mismatch"
              : null;
      if (preflightReason) {
        report(job.input, {
          stage: "continuity_director_refresh",
          chatId,
          trigger,
          status: "skipped",
          reason: preflightReason,
        });
        return;
      }
    } catch (error) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "error",
        reason: error instanceof Error ? error.message : "source_unavailable",
      });
      return;
    }

    let source;
    try {
      source = await loadSource(storage, chatId);
    } catch (error) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "error",
        reason: error instanceof Error ? error.message : "source_unavailable",
      });
      return;
    }

    const director = normalizeContinuityDirectorState(parseRecord(source.chat.metadata).roleplayContinuityDirector);
    const decision = decideContinuityDirectorRefresh({
      state: director,
      trigger,
      currentSourceSnapshot: source.sourceSnapshot,
      refreshPending: false,
    });
    if (!decision.eligible) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "skipped",
        reason: decision.reason,
      });
      return;
    }

    const result = await refreshPlan({ storage, llm }, { chatId });
    if (!result.ok) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "error",
        reason: result.code,
      });
      return;
    }
    report(job.input, {
      stage: "continuity_director_refresh",
      chatId,
      trigger,
      status: "ok",
      reason: decision.reason,
      rejectedUnsafeBeats: result.rejectedUnsafeBeats,
    });
  }

  async function drain(storage: StorageGateway, chatId: string, job: QueuedRefresh): Promise<void> {
    const scheduled = scheduledByStorage.get(storage);
    try {
      while (job.nextTrigger) {
        const trigger = job.nextTrigger;
        job.nextTrigger = null;
        try {
          await runOne(job, trigger);
        } catch (error) {
          report(job.input, {
            stage: "continuity_director_refresh",
            chatId,
            trigger,
            status: "error",
            reason: error instanceof Error ? error.message : "refresh_failed",
          });
        }
      }
    } finally {
      if (scheduled?.get(chatId) === job) scheduled.delete(chatId);
      if (scheduled?.size === 0) scheduledByStorage.delete(storage);
    }
  }

  return {
    schedule(input) {
      const chatId = input.chatId.trim();
      if (!chatId) return false;
      const normalizedInput = { ...input, chatId };
      const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, QueuedRefresh>();
      scheduledByStorage.set(input.storage, scheduled);
      const active = scheduled.get(chatId);
      if (active) {
        active.input = normalizedInput;
        active.nextTrigger = input.trigger;
        return true;
      }

      const job: QueuedRefresh = { input: normalizedInput, nextTrigger: input.trigger };
      scheduled.set(chatId, job);
      defer(() => void drain(input.storage, chatId, job));
      return true;
    },
    isPending(storage, chatId) {
      return scheduledByStorage.get(storage)?.has(chatId.trim()) ?? false;
    },
  };
}

const defaultScheduler = createContinuityDirectorRefreshScheduler();

export function scheduleContinuityDirectorRefresh(input: ScheduleContinuityDirectorRefreshInput): boolean {
  return defaultScheduler.schedule(input);
}
