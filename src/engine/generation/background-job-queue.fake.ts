import type {
  BackgroundJobOutcome,
  BackgroundJobQueueName,
  BackgroundJobsGateway,
  ClaimedBackgroundJob,
} from "../capabilities/background-jobs";

interface FakeJob extends ClaimedBackgroundJob {
  status: "queued" | "running" | "retryable" | "failed";
  claimLeaseId: string | null;
  rerunPayload: unknown;
  rerunRequested: boolean;
  /** Hold id -> epoch ms it lapses at. */
  holds: Map<string, number>;
  createdAt: number;
}

const HOLD_TTL_MS = 30_000;

function heldUntil(job: FakeJob): number | null {
  const live = [...job.holds.values()].filter((lapsesAt) => lapsesAt > Date.now());
  return live.length ? Math.max(...live) : null;
}

/**
 * In-memory stand-in for the runtime's `background-jobs` commands, following the same rules as
 * `src-tauri/src/commands/storage/background_jobs.rs`: one lease per queue, reruns requested
 * while a job runs, runs claimed under a lease that is gone being claimable again, and holds that
 * keep a job unclaimable until released or lapsed.
 */
export function createFakeBackgroundJobs() {
  const jobs = new Map<string, FakeJob>();
  const leases = new Map<BackgroundJobQueueName, { workerId: string; leaseId: string }>();
  const finished: Array<{ jobId: string; outcome: BackgroundJobOutcome; error?: string | null }> = [];
  let nextLease = 1;
  let clock = 0;

  const requireLease = (queue: BackgroundJobQueueName, leaseId: string) => {
    if (leases.get(queue)?.leaseId !== leaseId) throw new Error("background_worker_lease_lost");
  };

  const gateway: BackgroundJobsGateway = {
    async enqueue({ queue, key, chatId, payload, holdId, releaseHoldId }) {
      const id = `${queue}:${key}`;
      const existing = jobs.get(id);
      const holds = new Map(existing?.holds ?? []);
      if (releaseHoldId) holds.delete(releaseHoldId);
      if (holdId) holds.set(holdId, Date.now() + HOLD_TTL_MS);
      if (existing?.status === "running") {
        existing.holds = holds;
        existing.rerunRequested = true;
        existing.rerunPayload = payload;
        return;
      }
      jobs.set(id, {
        id,
        queue,
        key,
        chatId: chatId ?? null,
        payload,
        attempts: 0,
        status: "queued",
        claimLeaseId: null,
        rerunPayload: null,
        rerunRequested: false,
        holds,
        createdAt: existing?.createdAt ?? clock++,
      });
    },
    async acquireWorker(queue, workerId, leaseId) {
      const current = leases.get(queue);
      if (leaseId) return current?.workerId === workerId && current.leaseId === leaseId ? leaseId : null;
      if (current) return null;
      const granted = `lease-${nextLease++}`;
      leases.set(queue, { workerId, leaseId: granted });
      return granted;
    },
    async releaseWorker(queue, workerId, leaseId) {
      const current = leases.get(queue);
      if (current?.workerId === workerId && current.leaseId === leaseId) leases.delete(queue);
    },
    async claim(queue, leaseId) {
      requireLease(queue, leaseId);
      const claimable = [...jobs.values()].filter(
        (job) =>
          job.queue === queue &&
          (job.status === "queued" || (job.status === "running" && job.claimLeaseId !== leaseId)),
      );
      const due = claimable.filter((job) => heldUntil(job) === null).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!due) {
        const lapses = claimable.map(heldUntil).filter((at): at is number => at !== null);
        return { job: null, nextDueAt: lapses.length ? Math.min(...lapses) : null };
      }
      due.status = "running";
      due.claimLeaseId = leaseId;
      due.attempts += 1;
      return { job: { ...due }, nextDueAt: null };
    },
    async finish({ queue, leaseId, jobId, outcome, error }) {
      requireLease(queue, leaseId);
      const job = jobs.get(jobId);
      if (!job || job.claimLeaseId !== leaseId) throw new Error("background_job_not_claimed");
      finished.push({ jobId, outcome, error });
      if (job.rerunRequested) {
        Object.assign(job, {
          status: "queued",
          payload: job.rerunPayload,
          attempts: 0,
          claimLeaseId: null,
          rerunRequested: false,
          rerunPayload: null,
        });
        return;
      }
      if (outcome === "done") jobs.delete(jobId);
      else Object.assign(job, { status: outcome === "retry" ? "retryable" : "failed", claimLeaseId: null });
    },
  };

  return {
    gateway,
    jobs,
    finished,
    /** A client that vanished without releasing: its lease lapses, as the runtime's TTL does. */
    expireLease(queue: BackgroundJobQueueName) {
      leases.delete(queue);
    },
    holdLease(queue: BackgroundJobQueueName, workerId = "other-tab") {
      leases.set(queue, { workerId, leaseId: `held-${nextLease++}` });
    },
  };
}
