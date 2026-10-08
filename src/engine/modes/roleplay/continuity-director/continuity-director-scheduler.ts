import type { BackgroundJobOutcome, ClaimedBackgroundJob } from "../../../capabilities/background-jobs";
import type { LlmGateway } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { createBackgroundJobQueue, type BackgroundJobQueue } from "../../../generation/background-job-queue";
import { parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { refreshContinuityDirectorPlan } from "./continuity-director-planner";
import {
  decideContinuityDirectorRefresh,
  type ContinuityDirectorRefreshTrigger,
} from "./continuity-director-refresh-policy";
import { loadContinuityDirectorSource } from "./continuity-director-source";
import { normalizeContinuityDirectorState } from "./continuity-director-state";
import { publishContinuityDirectorRefreshCompletion } from "./continuity-director-refresh-events";

interface ContinuityDirectorRefreshDiagnostic {
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
  /**
   * Like `schedule`, but resolves once the refresh is stored on the runtime (or, when it cannot
   * be, handed to this tab). A reply only reports done after this, so closing the tab the moment
   * the reply finishes can no longer drop the refresh before it was queued.
   */
  scheduleDurably(input: ScheduleContinuityDirectorRefreshInput): Promise<boolean>;
  /**
   * Store the refresh on the runtime, placing or releasing a hold on it; rejects when it cannot be
   * stored (no fallback here, the caller decides).
   */
  enqueue(input: ScheduleContinuityDirectorRefreshInput & DirectorRefreshHold): Promise<void>;
  /** Run refreshes a closed tab left queued; call once a client starts. */
  resumeQueued(deps: DirectorQueueDependencies): void;
  isPending(storage: StorageGateway, chatId: string): boolean;
}

interface DirectorRefreshHold {
  holdId?: string;
  releaseHoldId?: string;
}

interface DirectorQueueDependencies {
  storage: StorageGateway;
  llm: LlmGateway;
}

interface SchedulerOverrides {
  defer?: (run: () => void) => void;
  loadSource?: typeof loadContinuityDirectorSource;
  refreshPlan?: typeof refreshContinuityDirectorPlan;
}

interface QueuedRefresh {
  input: ScheduleContinuityDirectorRefreshInput;
  nextTrigger: ContinuityDirectorRefreshTrigger | null;
  /** A durable job claimed again after an earlier claim never finished (its tab closed). */
  resumingInterruptedRun?: boolean;
}

const REFRESH_TRIGGERS: readonly ContinuityDirectorRefreshTrigger[] = [
  "scene_created",
  "scene_concluded",
  "assistant_saved",
];

function triggerFromPayload(payload: unknown): ContinuityDirectorRefreshTrigger | null {
  const trigger = parseRecord(payload).trigger;
  return REFRESH_TRIGGERS.find((candidate) => candidate === trigger) ?? null;
}

/** A missing chat is final; anything else thrown (runtime or model unreachable) is worth a retry. */
function isMissingChat(error: unknown): boolean {
  return error instanceof Error && error.message === "Chat not found";
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

  async function runOne(job: QueuedRefresh, trigger: ContinuityDirectorRefreshTrigger): Promise<BackgroundJobOutcome> {
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
        return "done";
      }
    } catch (error) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "error",
        reason: error instanceof Error ? error.message : "source_unavailable",
      });
      return isMissingChat(error) ? "done" : "retry";
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
      return "retry";
    }

    const director = normalizeContinuityDirectorState(parseRecord(source.chat.metadata).roleplayContinuityDirector);
    const decision = decideContinuityDirectorRefresh({
      state: director,
      trigger,
      currentSourceSnapshot: source.sourceSnapshot,
      refreshPending: false,
      resumingInterruptedRun: job.resumingInterruptedRun === true,
    });
    if (!decision.eligible) {
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "skipped",
        reason: decision.reason,
      });
      return "done";
    }

    const result = await refreshPlan({ storage, llm }, { chatId }).finally(() => {
      publishContinuityDirectorRefreshCompletion({ chatId });
    });
    if (!result.ok) {
      // The planner records the failure in the Director state, and its refresh policy decides
      // when to try again, so the queue does not retry it a second way.
      report(job.input, {
        stage: "continuity_director_refresh",
        chatId,
        trigger,
        status: "error",
        reason: result.code,
      });
      return "done";
    }
    report(job.input, {
      stage: "continuity_director_refresh",
      chatId,
      trigger,
      status: "ok",
      reason: decision.reason,
      rejectedUnsafeBeats: result.rejectedUnsafeBeats,
    });
    return "done";
  }

  // Refreshes queued here are stored by the runtime, so a tab closed right after a reply no
  // longer drops the plan: the next open client (or this one, after a reload) runs it.
  const durableQueue: BackgroundJobQueue<DirectorQueueDependencies> = createBackgroundJobQueue({
    queue: "continuity-director",
    async run(claimed: ClaimedBackgroundJob, deps) {
      const trigger = triggerFromPayload(claimed.payload);
      const chatId = claimed.chatId ?? claimed.key;
      if (!trigger || !chatId) return "failed";
      const job: QueuedRefresh = {
        input: { ...deps, chatId, trigger },
        nextTrigger: null,
        // A later claim of the same job means an earlier run started and never reported back.
        resumingInterruptedRun: claimed.attempts > 1,
      };
      return runOne(job, trigger);
    },
  });

  async function enqueue(input: ScheduleContinuityDirectorRefreshInput & DirectorRefreshHold): Promise<void> {
    const chatId = input.chatId.trim();
    if (!chatId) throw new Error("chatId is required");
    await durableQueue.enqueue(
      { storage: input.storage, llm: input.llm },
      {
        key: chatId,
        chatId,
        payload: { trigger: input.trigger },
        ...(input.holdId ? { holdId: input.holdId } : {}),
        ...(input.releaseHoldId ? { releaseHoldId: input.releaseHoldId } : {}),
      },
    );
  }

  async function scheduleDurably(input: ScheduleContinuityDirectorRefreshInput): Promise<boolean> {
    const chatId = input.chatId.trim();
    if (!chatId) return false;
    const normalizedInput = { ...input, chatId };
    if (!input.storage.backgroundJobs) {
      runInThisTab(normalizedInput);
      return true;
    }
    try {
      await enqueue(normalizedInput);
    } catch (error) {
      // The runtime could not store it; still refresh now, just not durably.
      console.warn("[continuity-director] could not queue the refresh; running it in this tab", error);
      runInThisTab(normalizedInput);
    }
    return true;
  }

  function runInThisTab(input: ScheduleContinuityDirectorRefreshInput): void {
    const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, QueuedRefresh>();
    scheduledByStorage.set(input.storage, scheduled);
    const active = scheduled.get(input.chatId);
    if (active) {
      active.input = input;
      active.nextTrigger = input.trigger;
      return;
    }
    const job: QueuedRefresh = { input, nextTrigger: input.trigger };
    scheduled.set(input.chatId, job);
    defer(() => void drain(input.storage, input.chatId, job));
  }

  async function drain(storage: StorageGateway, chatId: string, job: QueuedRefresh): Promise<void> {
    const scheduled = scheduledByStorage.get(storage);
    try {
      while (job.nextTrigger) {
        const trigger = job.nextTrigger;
        job.nextTrigger = null;
        try {
          if ((await runOne(job, trigger)) === "retry") {
            // Without a durable queue there is no later run to hand this to; say so.
            console.warn("[continuity-director] refresh failed and will not be retried in this tab", {
              chatId,
              trigger,
            });
          }
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
      if (!input.chatId.trim()) return false;
      void scheduleDurably(input);
      return true;
    },
    scheduleDurably,
    enqueue,
    resumeQueued(deps) {
      durableQueue.schedule(deps);
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

/** Store the refresh on the runtime with a hold placed or released; rejects when it cannot be stored. */
export function queueContinuityDirectorRefresh(
  input: ScheduleContinuityDirectorRefreshInput & DirectorRefreshHold,
): Promise<void> {
  return defaultScheduler.enqueue(input);
}

/**
 * Whether saving an assistant reply in this chat can start an automatic Director refresh. Only a
 * cadence Director refreshes on replies; queueing a reply trigger for any other chat would only
 * replace a scene trigger still waiting in the queue.
 */
export function assistantRepliesRefreshContinuityDirector(chat: JsonRecord): boolean {
  if (readString(chat.mode || chat.chatMode).trim() !== "roleplay") return false;
  const director = normalizeContinuityDirectorState(parseRecord(chat.metadata).roleplayContinuityDirector);
  return director.enabled && director.refreshMode === "cadence";
}

export function resumeQueuedContinuityDirectorRefreshes(deps: DirectorQueueDependencies): void {
  defaultScheduler.resumeQueued(deps);
}
