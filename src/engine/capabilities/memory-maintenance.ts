import type {
  MemoryCleanupApplyRequestV2,
  MemoryCleanupApplyResult,
  MemoryCleanupUndoRequestV2,
  MemoryCleanupUndoResult,
} from "../contracts/types/memory-maintenance";

export interface MemoryMaintenanceGateway {
  apply(body: MemoryCleanupApplyRequestV2): Promise<MemoryCleanupApplyResult>;
  undo(body: MemoryCleanupUndoRequestV2): Promise<MemoryCleanupUndoResult>;
}
