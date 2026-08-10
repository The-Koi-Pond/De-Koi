import type {
  MemoryCleanupApplyRequest,
  MemoryCleanupApplyResult,
  MemoryCleanupUndoRequest,
  MemoryCleanupUndoResult,
} from "../../engine/contracts/types/memory-maintenance";
import type { MemoryMaintenanceGateway } from "../../engine/capabilities/memory-maintenance";
import { invokeTauri } from "./tauri-client";

export const memoryMaintenanceApi = {
  acquireWorker: async (workerId: string, leaseId?: string) => {
    const result = await invokeTauri<{ acquired: boolean; leaseId?: string | null }>(
      "memory_maintenance_worker_acquire",
      {
        body: { workerId, ...(leaseId ? { leaseId } : {}) },
      },
    );
    return result.acquired === true && typeof result.leaseId === "string" ? result.leaseId : null;
  },
  releaseWorker: async (workerId: string, leaseId: string) => {
    await invokeTauri("memory_maintenance_worker_release", { body: { workerId, leaseId } });
  },
  updateJob: (leaseId: string, jobId: string, patch: Record<string, unknown>) =>
    invokeTauri<Record<string, unknown>>("memory_maintenance_job_update", { body: { leaseId, jobId, patch } }),
  apply: (body: MemoryCleanupApplyRequest, leaseId?: string) =>
    invokeTauri<MemoryCleanupApplyResult>("memory_cleanup_apply", { body, ...(leaseId ? { leaseId } : {}) }),
  undo: (body: MemoryCleanupUndoRequest) => invokeTauri<MemoryCleanupUndoResult>("memory_cleanup_undo", { body }),
} satisfies {
  acquireWorker(workerId: string, leaseId?: string): Promise<string | null>;
  releaseWorker(workerId: string, leaseId: string): Promise<void>;
  updateJob(leaseId: string, jobId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  apply(body: MemoryCleanupApplyRequest, leaseId?: string): Promise<MemoryCleanupApplyResult>;
  undo(body: MemoryCleanupUndoRequest): Promise<MemoryCleanupUndoResult>;
} & MemoryMaintenanceGateway;
