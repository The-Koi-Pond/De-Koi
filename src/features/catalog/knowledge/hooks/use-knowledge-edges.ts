import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { KnowledgeEdgeInput } from "../../../../engine/contracts/types/memory";
import { canonicalMemoryApi } from "../../../../shared/api/canonical-memory-api";
import { storageApi } from "../../../../shared/api/storage-api";

export const knowledgeEdgeKeys = {
  memory: (memoryId: string) => ["memory-knowledge-edges", memoryId] as const,
  holders: ["memory-knowledge-holders"] as const,
};

export function useKnowledgeEdges(memoryId: string | null) {
  return useQuery({
    queryKey: knowledgeEdgeKeys.memory(memoryId ?? ""),
    queryFn: async () => {
      const capabilities = await canonicalMemoryApi.knowledge.capabilities();
      if (!capabilities.knowledge_edges_v1) throw new Error("knowledge_edges_v1 is unavailable");
      return canonicalMemoryApi.knowledge.query({ memoryIds: [memoryId!] });
    },
    enabled: !!memoryId,
    retry: false,
  });
}

export function useKnowledgeHolders(enabled = true) {
  return useQuery({
    queryKey: knowledgeEdgeKeys.holders,
    queryFn: async () => {
      const [characters, personas, groups] = await Promise.all([
        storageApi.list<Record<string, unknown>>("characters", { fields: ["id", "name"] }),
        storageApi.list<Record<string, unknown>>("personas", { fields: ["id", "name"] }),
        storageApi.list<Record<string, unknown>>("character-groups", { fields: ["id", "name"] }),
      ]);
      const rows = (kind: "character" | "persona" | "group", values: Record<string, unknown>[]) =>
        values.flatMap((value) => {
          const id = typeof value.id === "string" ? value.id.trim() : "";
          if (!id) return [];
          const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : id;
          return [{ kind, id, name }];
        });
      return [
        { kind: "world" as const, id: "world", name: "World truth" },
        ...rows("character", characters),
        ...rows("persona", personas),
        ...rows("group", groups),
      ];
    },
    enabled,
    retry: false,
  });
}

export function useKnowledgeEdgeActions(memoryId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: knowledgeEdgeKeys.memory(memoryId) });
  return {
    upsert: useMutation({ mutationFn: (body: KnowledgeEdgeInput) => canonicalMemoryApi.knowledge.upsert(body), onSuccess: invalidate }),
    approve: useMutation({ mutationFn: (edgeId: string) => canonicalMemoryApi.knowledge.approve(edgeId), onSuccess: invalidate }),
    invalidate: useMutation({
      mutationFn: ({ edgeId, reason }: { edgeId: string; reason: string }) =>
        canonicalMemoryApi.knowledge.invalidate(edgeId, reason),
      onSuccess: invalidate,
    }),
  };
}
