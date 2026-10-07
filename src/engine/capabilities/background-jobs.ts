/** Queues the runtime accepts; must match `QUEUES` in `src-tauri/src/commands/storage/background_jobs.rs`. */
export type BackgroundJobQueueName = "continuity-director" | "lorebook-keeper";

export type BackgroundJobOutcome = "done" | "retry" | "failed";

export interface ClaimedBackgroundJob {
  id: string;
  queue: BackgroundJobQueueName;
  key: string;
  chatId: string | null;
  payload: unknown;
  /** 1 on the first run; counts claims, including runs a closed tab never finished. */
  attempts: number;
}

export interface BackgroundJobClaim {
  job: ClaimedBackgroundJob | null;
  /** With nothing due: when the next retry is due (epoch ms), or null when the queue is empty. */
  nextDueAt: number | null;
}

/**
 * Durable background work stored by the runtime. Jobs outlive the tab that queued them; one
 * worker per queue (any open client) holds a lease and claims due jobs.
 */
export interface BackgroundJobsGateway {
  /**
   * `holdId` places (or renews) a hold: no worker claims a job while any hold on it is live. Hold it
   * while this client is still writing what the job reads, renew within 30s (an unrenewed hold
   * lapses, so a closed tab's job still runs), and enqueue with `releaseHoldId` once that is done.
   */
  enqueue(input: {
    queue: BackgroundJobQueueName;
    key: string;
    chatId?: string | null;
    payload: unknown;
    holdId?: string;
    releaseHoldId?: string;
  }): Promise<void>;
  acquireWorker(queue: BackgroundJobQueueName, workerId: string, leaseId?: string): Promise<string | null>;
  releaseWorker(queue: BackgroundJobQueueName, workerId: string, leaseId: string): Promise<void>;
  claim(queue: BackgroundJobQueueName, leaseId: string): Promise<BackgroundJobClaim>;
  finish(input: {
    queue: BackgroundJobQueueName;
    leaseId: string;
    jobId: string;
    outcome: BackgroundJobOutcome;
    error?: string | null;
  }): Promise<void>;
}
