import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  CanonicalMemorySemanticMatch,
  CanonicalMemorySemanticQuery,
  KnowledgeEdge,
  KnowledgeEdgeInput,
  KnowledgeEdgeQuery,
  MemoryIndexDeleteResult,
  MemoryIndexRow,
  MemoryIndexRowInput,
  MemoryLexicalRebuildResult,
  MemoryIndexHealth,
} from "../../engine/contracts/types/memory";
import { invokeTauri } from "./tauri-client";

async function knowledgeEdgeCapabilities(): Promise<{ knowledge_edges_v1: boolean }> {
  try {
    return await invokeTauri<{ knowledge_edges_v1: boolean }>("knowledge_edge_capabilities");
  } catch (error) {
    const status = error && typeof error === "object" ? Number((error as { status?: unknown }).status) : 0;
    if (status === 404 || status === 501) {
      return { knowledge_edges_v1: false };
    }
    throw error;
  }
}

export const canonicalMemoryApi = {
  create: (body: CanonicalMemoryInput) => invokeTauri<CanonicalMemoryRecord>("memory_create", { body }),
  get: (memoryId: string) => invokeTauri<CanonicalMemoryRecord>("memory_get", { memoryId }),
  update: (memoryId: string, patch: CanonicalMemoryPatch) =>
    invokeTauri<CanonicalMemoryRecord>("memory_update", { memoryId, patch }),
  delete: (memoryId: string) => invokeTauri<CanonicalMemoryRecord>("memory_delete", { memoryId }),
  query: (body: CanonicalMemoryQuery = {}) => invokeTauri<CanonicalMemoryRecord[]>("memory_query", { body }),
  queryBatch: (queries: CanonicalMemoryQuery[]) =>
    invokeTauri<CanonicalMemoryRecord[]>("memory_query_batch", { body: { queries } }),
  querySemantic: (body: CanonicalMemorySemanticQuery) =>
    invokeTauri<CanonicalMemorySemanticMatch[]>("memory_query_semantic", { body }),
  knowledge: {
    capabilities: knowledgeEdgeCapabilities,
    upsert: (body: KnowledgeEdgeInput) => invokeTauri<KnowledgeEdge>("knowledge_edge_upsert", { body }),
    query: (body: KnowledgeEdgeQuery = {}) => invokeTauri<KnowledgeEdge[]>("knowledge_edge_query", { body }),
    approve: (edgeId: string) => invokeTauri<KnowledgeEdge>("knowledge_edge_approve", { edgeId }),
    invalidate: (edgeId: string, reason: string) =>
      invokeTauri<KnowledgeEdge>("knowledge_edge_invalidate", { edgeId, reason }),
  },
  index: {
    health: () => invokeTauri<MemoryIndexHealth>("memory_index_health"),
    upsert: (row: MemoryIndexRowInput) => invokeTauri<MemoryIndexRow>("memory_index_upsert", { row }),
    deleteForMemory: (memoryId: string) =>
      invokeTauri<MemoryIndexDeleteResult>("memory_index_delete_for_memory", { memoryId }),
    rebuildLexical: (body: CanonicalMemoryQuery = {}) =>
      invokeTauri<MemoryLexicalRebuildResult>("memory_index_rebuild_lexical", { body }),
    query: (body: CanonicalMemoryQuery = {}) => invokeTauri<CanonicalMemoryRecord[]>("memory_index_query", { body }),
    queryBatch: (queries: CanonicalMemoryQuery[]) =>
      invokeTauri<CanonicalMemoryRecord[]>("memory_index_query_batch", { body: { queries } }),
  },
};
