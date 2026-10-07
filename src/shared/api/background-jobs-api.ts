import type {
  BackgroundJobClaim,
  BackgroundJobsGateway,
  ClaimedBackgroundJob,
} from "../../engine/capabilities/background-jobs";
import { invokeTauri } from "./tauri-client";

function readClaimedJob(value: unknown): ClaimedBackgroundJob | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.key !== "string") return null;
  return {
    id: record.id,
    queue: record.queue as ClaimedBackgroundJob["queue"],
    key: record.key,
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    payload: record.payload ?? null,
    attempts: typeof record.attempts === "number" ? record.attempts : 1,
  };
}

export const backgroundJobsApi: BackgroundJobsGateway = {
  enqueue: async ({ queue, key, chatId, payload, delayMs }) => {
    await invokeTauri("background_job_enqueue", {
      body: { queue, key, chatId: chatId ?? null, payload, ...(delayMs ? { delayMs } : {}) },
    });
  },
  acquireWorker: async (queue, workerId, leaseId) => {
    const result = await invokeTauri<{ acquired: boolean; leaseId?: string | null }>("background_worker_acquire", {
      body: { queue, workerId, ...(leaseId ? { leaseId } : {}) },
    });
    return result.acquired === true && typeof result.leaseId === "string" ? result.leaseId : null;
  },
  releaseWorker: async (queue, workerId, leaseId) => {
    await invokeTauri("background_worker_release", { body: { queue, workerId, leaseId } });
  },
  claim: async (queue, leaseId): Promise<BackgroundJobClaim> => {
    const result = await invokeTauri<{ job?: unknown; nextDueAt?: unknown }>("background_job_claim", {
      body: { queue, leaseId },
    });
    return {
      job: readClaimedJob(result.job),
      nextDueAt: typeof result.nextDueAt === "number" ? result.nextDueAt : null,
    };
  },
  finish: async ({ queue, leaseId, jobId, outcome, error }) => {
    await invokeTauri("background_job_finish", { body: { queue, leaseId, jobId, outcome, error: error ?? null } });
  },
};
