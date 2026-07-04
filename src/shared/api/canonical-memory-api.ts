import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  MemoryIndexDeleteResult,
  MemoryIndexRow,
  MemoryIndexRowInput,
  MemoryLexicalRebuildResult,
} from "../../engine/contracts/types/memory";
import { invokeTauri } from "./tauri-client";

export const canonicalMemoryApi = {
  create: (body: CanonicalMemoryInput) => invokeTauri<CanonicalMemoryRecord>("memory_create", { body }),
  get: (memoryId: string) => invokeTauri<CanonicalMemoryRecord>("memory_get", { memoryId }),
  update: (memoryId: string, patch: CanonicalMemoryPatch) =>
    invokeTauri<CanonicalMemoryRecord>("memory_update", { memoryId, patch }),
  delete: (memoryId: string) => invokeTauri<CanonicalMemoryRecord>("memory_delete", { memoryId }),
  query: (body: CanonicalMemoryQuery = {}) => invokeTauri<CanonicalMemoryRecord[]>("memory_query", { body }),
  index: {
    upsert: (row: MemoryIndexRowInput) => invokeTauri<MemoryIndexRow>("memory_index_upsert", { row }),
    deleteForMemory: (memoryId: string) =>
      invokeTauri<MemoryIndexDeleteResult>("memory_index_delete_for_memory", { memoryId }),
    rebuildLexical: (body: CanonicalMemoryQuery = {}) =>
      invokeTauri<MemoryLexicalRebuildResult>("memory_index_rebuild_lexical", { body }),
    query: (body: CanonicalMemoryQuery = {}) => invokeTauri<CanonicalMemoryRecord[]>("memory_index_query", { body }),
  },
};