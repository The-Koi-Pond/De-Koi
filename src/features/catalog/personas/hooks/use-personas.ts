import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { personaKeys } from "../query-keys";
import { personaApi } from "../../../../shared/api/persona-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { storageCommandsApi } from "../../../../shared/api/storage-commands-api";

export function useUpdatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      comment?: string;
      description?: string;
      personality?: string;
      scenario?: string;
      backstory?: string;
      appearance?: string;
      tags?: string[];
      altDescriptions?: unknown[];
      savedStatusOptions?: string[];
      avatarCrop?: unknown;
      personaStats?: unknown;
    }) => storageApi.update("personas", id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.list }),
  });
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("personas", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.list }),
  });
}

export function useDuplicatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageCommandsApi.duplicate("personas", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.list }),
  });
}

export function useActivatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => personaApi.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.list }),
  });
}

export function useUploadPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, avatar, filename }: { id: string; avatar: string; filename?: string }) =>
      personaApi.uploadAvatar(id, avatar, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.list }),
  });
}

export function usePersonaGroups() {
  return useQuery({
    queryKey: personaKeys.groups,
    queryFn: () => storageApi.list<unknown>("persona-groups"),
  });
}

export function useCreatePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; personaIds?: string[] }) =>
      storageApi.create("persona-groups", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.groups }),
  });
}

export function useUpdatePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; personaIds?: string[] }) =>
      storageApi.update("persona-groups", id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.groups }),
  });
}

export function useDeletePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("persona-groups", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: personaKeys.groups }),
  });
}
