// ──────────────────────────────────────────────
// React Query: Connection Folder hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { ConnectionFolder } from "@marinara-engine/shared";
import { connectionKeys } from "./use-connections";

export const connectionFolderKeys = {
  all: ["connection-folders"] as const,
  list: () => [...connectionFolderKeys.all, "list"] as const,
};

export function useConnectionFolders() {
  return useQuery({
    queryKey: connectionFolderKeys.list(),
    queryFn: () => api.get<ConnectionFolder[]>("/connection-folders"),
    staleTime: 2 * 60_000,
  });
}

export function useCreateConnectionFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) => api.post<ConnectionFolder>("/connection-folders", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionFolderKeys.list() }),
  });
}

export function useUpdateConnectionFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      color?: string;
      sortOrder?: number;
      collapsed?: boolean;
    }) => api.patch<ConnectionFolder>(`/connection-folders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionFolderKeys.list() }),
  });
}

export function useDeleteConnectionFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/connection-folders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionFolderKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
    },
  });
}

export function useReorderConnectionFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => api.post("/connection-folders/reorder", { orderedIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionFolderKeys.list() }),
  });
}

export function useMoveConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { connectionId: string; folderId: string | null }) =>
      api.post("/connection-folders/move-connection", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}
