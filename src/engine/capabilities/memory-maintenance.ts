import type {
  MemoryCleanupApplyRequestV2,
  MemoryCleanupApplyResult,
  MemoryCleanupUndoRequestV2,
  MemoryCleanupUndoResult,
} from "../contracts/types/memory-maintenance";

export interface MemoryMaintenanceGateway {
  acquireWorker(workerId: string, leaseId?: string): Promise<string | null>;
  releaseWorker(workerId: string, leaseId: string): Promise<void>;
  updateJob(leaseId: string, jobId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  apply(body: MemoryCleanupApplyRequestV2, leaseId?: string): Promise<MemoryCleanupApplyResult>;
  undo(body: MemoryCleanupUndoRequestV2): Promise<MemoryCleanupUndoResult>;
}
