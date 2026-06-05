// ──────────────────────────────────────────────
// Global Gallery hooks
// A profile-wide image library (the `global-gallery` collection) organized by
// optional flat folders (the `gallery-folders` collection). Unlike the chat,
// character, and persona galleries, images here have no owner entity — they are
// filed into folders purely for organization (folderId = null means root).
// Management only; emoji/sticker tagging arrives in a later change.
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { globalGalleryKeys } from "../query-keys";
import { galleryApi } from "../../../../shared/api/image-generation-api";
import { resolveGalleryFileUrl } from "../../../../shared/api/local-file-api";
import { storageApi } from "../../../../shared/api/storage-api";

export interface GlobalGalleryImage {
  id: string;
  folderId: string | null;
  filePath: string;
  filename?: string | null;
  prompt: string;
  provider: string;
  model: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
}

export interface GalleryFolder {
  id: string;
  name: string;
  createdAt: string;
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function imageCreatedAt(image: GlobalGalleryImage): number {
  const timestamp = Date.parse(image.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function normalizeGlobalGalleryImage(image: GlobalGalleryImage): Promise<GlobalGalleryImage> {
  const managedUrl = await resolveGalleryFileUrl(image.filename, image.filePath).catch(() => null);
  return {
    ...image,
    folderId: readTrimmed(image.folderId) || null,
    url: managedUrl || readTrimmed(image.url) || readTrimmed(image.filePath),
  };
}

export function useGlobalGalleryImages() {
  return useQuery({
    queryKey: globalGalleryKeys.images,
    queryFn: async () => {
      const rows = await storageApi.list<GlobalGalleryImage>("global-gallery");
      const normalized = await Promise.all(rows.map(normalizeGlobalGalleryImage));
      return normalized.sort((a, b) => imageCreatedAt(b) - imageCreatedAt(a));
    },
    staleTime: 5 * 60_000,
  });
}

export function useUploadGlobalGalleryImages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, folderId }: { files: File[]; folderId: string | null }) => {
      const uploads = await Promise.allSettled(
        files.map((file) => galleryApi.uploadGlobal<GlobalGalleryImage>(file, folderId)),
      );

      const successful = uploads.filter(
        (result): result is PromiseFulfilledResult<GlobalGalleryImage> => result.status === "fulfilled",
      );

      // Intentional partial-success-as-failure: if some files succeed and one
      // fails, the successful rows are already persisted yet we still throw (and a
      // retry re-uploads everything, duplicating the winners). Kept this way to
      // match useUploadCharacterGalleryImage and the chat gallery's
      // useUploadGalleryImage so all gallery uploads behave identically — "fixing"
      // it only here would split that behavior. If true partial-success semantics
      // are wanted, change every gallery upload together, not just this one.
      if (successful.length !== uploads.length) {
        const failedCount = uploads.length - successful.length;
        throw new Error(
          failedCount === 1
            ? "One gallery image failed to upload."
            : `${failedCount} gallery images failed to upload.`,
        );
      }

      return successful.map((result) => result.value);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.images });
    },
  });
}

export function useDeleteGlobalGalleryImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => storageApi.delete("global-gallery", imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.images });
    },
  });
}

export function useMoveGlobalGalleryImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ imageId, folderId }: { imageId: string; folderId: string | null }) =>
      storageApi.update("global-gallery", imageId, { folderId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.images });
    },
  });
}

// ── Folders ──

function folderCreatedAt(folder: GalleryFolder): number {
  const timestamp = Date.parse(folder.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function useGalleryFolders() {
  return useQuery({
    queryKey: globalGalleryKeys.folders,
    queryFn: async () => {
      const rows = await storageApi.list<GalleryFolder>("gallery-folders");
      return rows.sort((a, b) => folderCreatedAt(a) - folderCreatedAt(b));
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateGalleryFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => storageApi.create<GalleryFolder>("gallery-folders", { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.folders });
    },
  });
}

export function useRenameGalleryFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      storageApi.update("gallery-folders", folderId, { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.folders });
    },
  });
}

export function useDeleteGalleryFolder() {
  const qc = useQueryClient();
  return useMutation({
    // The backend ClearGalleryFolder cleanup re-files this folder's images back
    // to the root level (folderId = null), so deleting a folder never deletes
    // the images inside it.
    mutationFn: (folderId: string) => storageApi.delete("gallery-folders", folderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalGalleryKeys.folders });
      qc.invalidateQueries({ queryKey: globalGalleryKeys.images });
    },
  });
}
