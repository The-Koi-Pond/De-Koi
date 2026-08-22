import { invokeTauri } from "./tauri-client";

export const memoryCaptureApi = {
  acquireWorker: async (workerId: string, leaseId?: string) => {
    const result = await invokeTauri<{ acquired: boolean; leaseId?: string | null }>("memory_capture_worker_acquire", {
      body: { workerId, ...(leaseId ? { leaseId } : {}) },
    });
    return result.acquired === true && typeof result.leaseId === "string" ? result.leaseId : null;
  },
  releaseWorker: async (workerId: string, leaseId: string) => {
    await invokeTauri("memory_capture_worker_release", { body: { workerId, leaseId } });
  },
  updateJob: (leaseId: string, jobId: string, patch: Record<string, unknown>) =>
    invokeTauri<Record<string, unknown>>("memory_capture_job_update", { body: { leaseId, jobId, patch } }),
};
