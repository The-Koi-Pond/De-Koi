import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { updateLorebookSchema } from "../../../engine/contracts/schemas/lorebook.schema";
import {
  createLibraryFolderSchema,
  updateLibraryFolderSchema,
} from "../../../engine/contracts/schemas/library-folder.schema";
import { updatePromptPresetSchema } from "../../../engine/contracts/schemas/prompt.schema";
import type { LibraryFolder } from "../../../engine/contracts/types/library-folder";
import type { StorageEntity } from "../../../engine/capabilities/storage";
import { storageApi } from "../../../shared/api/storage-api";
import { lorebookKeys } from "../lorebooks/query-keys";
import { presetKeys } from "../presets/query-keys";
import { toast } from "sonner";
import { optimisticallyUpdateFolder, rollbackOptimisticFolderUpdate } from "../lib/optimistic-folder-update";

export type LibraryFolderScope = "lorebooks" | "presets";

const libraryFolderKeys = {
  all: ["library-folders"] as const,
  list: (scope: LibraryFolderScope) => [...libraryFolderKeys.all, scope] as const,
};

const scopeCollections: Record<
  LibraryFolderScope,
  {
    folderEntity: StorageEntity;
    itemEntity: StorageEntity;
  }
> = {
  lorebooks: { folderEntity: "lorebook-library-folders", itemEntity: "lorebooks" },
  presets: { folderEntity: "preset-folders", itemEntity: "prompts" },
};

function sortedFolders(folders: LibraryFolder[]): LibraryFolder[] {
  return [...folders].sort(
    (a, b) => (a.sortOrder ?? a.order ?? 0) - (b.sortOrder ?? b.order ?? 0) || a.name.localeCompare(b.name),
  );
}

export function getNextUnnamedLibraryFolderName(folders: Array<{ name: string }>): string {
  const names = new Set(folders.map((folder) => folder.name.trim().toLowerCase()).filter(Boolean));
  if (!names.has("new folder")) return "New Folder";
  let index = 2;
  while (names.has(`new folder ${index}`)) index += 1;
  return `New Folder ${index}`;
}

export function useLibraryFolders(scope: LibraryFolderScope) {
  const { folderEntity } = scopeCollections[scope];
  return useQuery({
    queryKey: libraryFolderKeys.list(scope),
    queryFn: async () => sortedFolders(await storageApi.list<LibraryFolder>(folderEntity)),
    staleTime: 2 * 60_000,
  });
}

export function useCreateLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  const { folderEntity } = scopeCollections[scope];
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const existing = await storageApi.list<LibraryFolder>(folderEntity);
      const nextOrder =
        existing
          .map((folder) => folder.sortOrder ?? folder.order ?? 0)
          .filter((order) => Number.isFinite(order))
          .reduce((max, order) => Math.max(max, order), -10) + 10;
      return storageApi.create<LibraryFolder>(
        folderEntity,
        createLibraryFolderSchema.parse({ ...data, sortOrder: nextOrder, order: nextOrder }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) }),
  });
}

export function useUpdateLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  const { folderEntity } = scopeCollections[scope];
  const queryKey = libraryFolderKeys.list(scope);
  const mutationKey = [...queryKey, "update"] as const;
  return useMutation({
    mutationKey,
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      collapsed?: boolean;
      sortOrder?: number;
      order?: number;
    }) => storageApi.update<LibraryFolder>(folderEntity, id, updateLibraryFolderSchema.parse(data)),
    onMutate: (variables) => optimisticallyUpdateFolder<LibraryFolder>(qc, queryKey, variables),
    onError: (_error, _variables, context) => {
      rollbackOptimisticFolderUpdate<LibraryFolder>(qc, queryKey, context);
      toast.error("Couldn't update that folder. Your previous folder state was restored.");
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) return qc.invalidateQueries({ queryKey });
    },
  });
}

export function useDeleteLibraryFolder(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  const { folderEntity } = scopeCollections[scope];
  return useMutation({
    mutationFn: (id: string) => storageApi.delete(folderEntity, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryFolderKeys.list(scope) });
      if (scope === "lorebooks") qc.invalidateQueries({ queryKey: lorebookKeys.all });
      else qc.invalidateQueries({ queryKey: presetKeys.all });
    },
  });
}

export function useMoveLibraryItem(scope: LibraryFolderScope) {
  const qc = useQueryClient();
  const { itemEntity } = scopeCollections[scope];
  return useMutation({
    mutationFn: ({ itemId, folderId }: { itemId: string; folderId: string | null }) => {
      const patch =
        scope === "lorebooks" ? updateLorebookSchema.parse({ folderId }) : updatePromptPresetSchema.parse({ folderId });
      return storageApi.update(itemEntity, itemId, patch);
    },
    onSuccess: () => {
      if (scope === "lorebooks") qc.invalidateQueries({ queryKey: lorebookKeys.all });
      else qc.invalidateQueries({ queryKey: presetKeys.all });
    },
  });
}
