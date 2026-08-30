import { invokeTauri } from "./tauri-client";
import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  KnowledgeEdgeInput,
  MemoryLexicalRebuildResult,
} from "../../engine/contracts/types/memory";

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
  createMemory: (leaseId: string, memory: CanonicalMemoryInput, knowledgeEdges: KnowledgeEdgeInput[] = []) =>
    invokeTauri<CanonicalMemoryRecord>("memory_capture_memory_create", {
      body: { leaseId, memory, knowledgeEdges },
    }),
  updateMemory: (
    leaseId: string,
    memoryId: string,
    patch: CanonicalMemoryPatch,
    knowledgeEdges: KnowledgeEdgeInput[] = [],
  ) =>
    invokeTauri<CanonicalMemoryRecord>("memory_capture_memory_update", {
      body: { leaseId, memoryId, patch, knowledgeEdges },
    }),
  patchMessageExtra: <T = unknown>(leaseId: string, messageId: string, patch: Record<string, unknown>) =>
    invokeTauri<T>("memory_capture_message_extra_patch", { body: { leaseId, messageId, patch } }),
  rebuildIndex: (leaseId: string, query?: CanonicalMemoryQuery) =>
    invokeTauri<MemoryLexicalRebuildResult>("memory_capture_index_rebuild", {
      body: { leaseId, query: query ?? null },
    }),
};
