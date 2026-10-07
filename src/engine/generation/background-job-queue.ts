import type {
  BackgroundJobOutcome,
  BackgroundJobQueueName,
  BackgroundJobsGateway,
  ClaimedBackgroundJob,
} from "../capabilities/background-jobs";
import type { StorageGateway } from "../capabilities/storage";
import {
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
} from "./background-generation-coordinator";

const LEASE_HEARTBEAT_MS = 10_000;
/** Another client holds the queue; its lease lapses within 30s if that client is gone. */
const LEASE_BUSY_RETRY_MS = 10_000;
const PASS_FAILURE_RETRY_MS = 60_000;

export interface BackgroundJobQueueDependencies {
  storage: StorageGateway;
}

export interface BackgroundJobQueue<Deps extends BackgroundJobQueueDependencies> {
  /** Store the job (or a rerun of it) on the runtime, then make sure a worker picks it up. */
  enqueue(
    deps: Deps,
    input: { key: string; chatId?: string | null; payload: unknown; holdId?: string; releaseHoldId?: string },
  ): Promise<void>;
  /** Run whatever is due. Safe to call often: passes coalesce and only one client runs a queue. */
  schedule(deps: Deps): void;
  cancel(storage: StorageGateway): void;
}

export interface BackgroundJobQueueDefinition<Deps extends BackgroundJobQueueDependencies> {
  queue: BackgroundJobQueueName;
  run(job: ClaimedBackgroundJob, deps: Deps): Promise<BackgroundJobOutcome>;
  /** Overridable for tests. */
  timings?: { heartbeatMs?: number; busyRetryMs?: number; failureRetryMs?: number };
}

interface QueueState {
  active: boolean;
  rerun: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

// One id per page load: a reload is a new worker, so the server never mistakes it for the old one.
const workerId = `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createBackgroundJobQueue<Deps extends BackgroundJobQueueDependencies>(
  definition: BackgroundJobQueueDefinition<Deps>,
): BackgroundJobQueue<Deps> {
  const { queue } = definition;
  const heartbeatMs = definition.timings?.heartbeatMs ?? LEASE_HEARTBEAT_MS;
  const busyRetryMs = definition.timings?.busyRetryMs ?? LEASE_BUSY_RETRY_MS;
  const failureRetryMs = definition.timings?.failureRetryMs ?? PASS_FAILURE_RETRY_MS;
  const states = new WeakMap<StorageGateway, QueueState>();
  const foregroundKey = {};

  function stateFor(storage: StorageGateway): QueueState {
    let state = states.get(storage);
    if (!state) {
      state = { active: false, rerun: false, timer: null };
      states.set(storage, state);
    }
    return state;
  }

  function clearTimer(state: QueueState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  function scheduleAfter(deps: Deps, delayMs: number): void {
    const state = stateFor(deps.storage);
    clearTimer(state);
    state.timer = setTimeout(
      () => {
        state.timer = null;
        schedule(deps);
      },
      Math.max(0, delayMs),
    );
  }

  /** One pass: hold the lease, run every due job, report when to look again (ms) or null. */
  async function runPass(jobs: BackgroundJobsGateway, deps: Deps): Promise<number | null> {
    const leaseId = await jobs.acquireWorker(queue, workerId);
    if (!leaseId) return busyRetryMs;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void jobs
        .acquireWorker(queue, workerId, leaseId)
        .then((renewed) => {
          if (renewed !== leaseId) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, heartbeatMs);
    try {
      for (;;) {
        if (leaseLost) return busyRetryMs;
        // A reply started in this tab: stop claiming; the next pass waits for it to finish.
        if (foregroundGenerationActive(deps.storage)) return 0;
        const claim = await jobs.claim(queue, leaseId);
        if (!claim.job) {
          return claim.nextDueAt === null ? null : Math.max(0, claim.nextDueAt - Date.now());
        }
        let outcome: BackgroundJobOutcome;
        let error: string | null = null;
        try {
          outcome = await definition.run(claim.job, deps);
        } catch (runError) {
          outcome = "retry";
          error = errorText(runError);
          console.warn(`[background-jobs] ${queue} job ${claim.job.id} failed; will retry`, runError);
        }
        await jobs.finish({ queue, leaseId, jobId: claim.job.id, outcome, error });
      }
    } finally {
      clearInterval(heartbeat);
      if (!leaseLost) {
        await jobs.releaseWorker(queue, workerId, leaseId).catch((releaseError: unknown) => {
          // The lease lapses on its own; the next pass (here or in another client) takes over.
          console.warn(`[background-jobs] could not release the ${queue} lease`, releaseError);
        });
      }
    }
  }

  function schedule(deps: Deps): void {
    const jobs = deps.storage.backgroundJobs;
    if (!jobs) return;
    const state = stateFor(deps.storage);
    if (state.active) {
      state.rerun = true;
      return;
    }
    if (foregroundGenerationActive(deps.storage)) {
      deferUntilForegroundGenerationCompletes(deps.storage, foregroundKey, () => schedule(deps));
      return;
    }
    clearTimer(state);
    state.active = true;
    let nextDelayMs: number | null = null;
    void runPass(jobs, deps)
      .then(
        (delayMs) => {
          nextDelayMs = delayMs;
        },
        (error: unknown) => {
          nextDelayMs = failureRetryMs;
          console.warn(`[background-jobs] ${queue} pass failed; retrying in ${failureRetryMs / 1000}s`, error);
        },
      )
      .finally(() => {
        state.active = false;
        if (state.rerun) {
          state.rerun = false;
          schedule(deps);
          return;
        }
        if (nextDelayMs !== null) scheduleAfter(deps, nextDelayMs);
      });
  }

  return {
    async enqueue(deps, input) {
      const jobs = deps.storage.backgroundJobs;
      if (!jobs) throw new Error("This runtime cannot store background jobs");
      await jobs.enqueue({
        queue,
        key: input.key,
        chatId: input.chatId ?? null,
        payload: input.payload,
        ...(input.holdId ? { holdId: input.holdId } : {}),
        ...(input.releaseHoldId ? { releaseHoldId: input.releaseHoldId } : {}),
      });
      schedule(deps);
    },
    schedule,
    cancel(storage) {
      const state = states.get(storage);
      if (state) clearTimer(state);
    },
  };
}
