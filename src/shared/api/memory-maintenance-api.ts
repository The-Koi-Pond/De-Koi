import type {
  MemoryCleanupApplyRequest,
  MemoryCleanupApplyResult,
  MemoryCleanupUndoRequest,
  MemoryCleanupUndoResult,
} from "../../engine/contracts/types/memory-maintenance";
import type { MemoryMaintenanceGateway } from "../../engine/capabilities/memory-maintenance";
import { invokeTauri } from "./tauri-client";

export const memoryMaintenanceApi = {
  apply: (body: MemoryCleanupApplyRequest) => invokeTauri<MemoryCleanupApplyResult>("memory_cleanup_apply", { body }),
  undo: (body: MemoryCleanupUndoRequest) => invokeTauri<MemoryCleanupUndoResult>("memory_cleanup_undo", { body }),
} satisfies {
  apply(body: MemoryCleanupApplyRequest): Promise<MemoryCleanupApplyResult>;
  undo(body: MemoryCleanupUndoRequest): Promise<MemoryCleanupUndoResult>;
} & MemoryMaintenanceGateway;
