// ──────────────────────────────────────────────
// React Query: Character, Group & Persona hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { characterKeys, spriteKeys } from "../query-keys";
import { storageApi } from "../../../../shared/api/storage-api";
import { invokeTauri } from "../../../../shared/api/tauri-client";
import { galleryApi, spriteApi } from "../../../../shared/api/image-generation-api";
import type { CharacterCardVersion } from "../../../../engine/contracts/types/character";
import type { SpriteCapabilities, SpriteCleanupEngine } from "../../../../shared/types/sprite-capabilities";

export { characterKeys, spriteKeys } from "../query-keys";

// ── Characters ──

export function useCharacters(enabled = true) {
  return useQuery({
    queryKey: characterKeys.list(),
    queryFn: () => storageApi.list<unknown>("characters"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCharacter(id: string | null) {
  return useQuery({
    queryKey: characterKeys.detail(id ?? ""),
    queryFn: () => storageApi.get("characters", id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useCreateCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => storageApi.create("characters", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.list() }),
  });
}

export function useUpdateCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      data?: Record<string, unknown>;
      avatarPath?: string;
      comment?: string;
      versionSource?: string;
      versionReason?: string;
      skipVersionSnapshot?: boolean;
    }) => storageApi.update("characters", id, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: characterKeys.list() });
      qc.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: characterKeys.versions(variables.id) });
    },
  });
}

export function useCharacterVersions(id: string | null) {
  return useQuery({
    queryKey: characterKeys.versions(id ?? ""),
    queryFn: () => storageApi.list<CharacterCardVersion>("character-versions", { filters: { characterId: id } }),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useRestoreCharacterVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      invokeTauri("character_restore_version", { characterId: id, versionId }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: characterKeys.list() });
      qc.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: characterKeys.versions(variables.id) });
    },
  });
}

export function useDeleteCharacterVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId }: { id: string; versionId: string }) => storageApi.delete("character-versions", versionId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: characterKeys.versions(variables.id) });
    },
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, avatar }: { id: string; avatar: string }) =>
      invokeTauri("character_avatar_upload", { id, body: { avatar } }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: characterKeys.list() });
      qc.invalidateQueries({ queryKey: characterKeys.detail(variables.id) });
    },
  });
}

export function useDeleteCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("characters", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.list() }),
  });
}

export function useDuplicateCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invokeTauri("storage_duplicate", { entity: "characters", id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.list() }),
  });
}

// ── Character Sprites ──

export interface SpriteInfo {
  expression: string;
  filename: string;
  url: string;
}

export interface SpriteUploadItem {
  expression: string;
  image: string;
}

export interface SpriteBulkUploadResult {
  imported: number;
  failed: Array<{ expression: string; filename?: string; error: string }>;
  sprites: SpriteInfo[];
}

export interface SpriteCleanupResult {
  processed: number;
  failed: Array<{ expression: string; error: string }>;
  restorePointId?: string | null;
  engine?: SpriteCleanupEngine;
  externalCleanupProcessed?: number;
  builtinProcessed?: number;
  sprites: SpriteInfo[];
  error?: string;
}

export interface SpriteCleanupRestoreResult {
  restored: number;
  failed: Array<{ expression: string; error: string }>;
  sprites: SpriteInfo[];
  error?: string;
}

export interface CharacterGalleryImage {
  id: string;
  characterId: string;
  filePath: string;
  prompt: string;
  provider: string;
  model: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
}

export function useSpriteCapabilities() {
  return useQuery({
    queryKey: spriteKeys.capabilities(),
    queryFn: () => spriteApi.capabilities<SpriteCapabilities>(),
    staleTime: 5 * 60_000,
  });
}

export function useCharacterSprites(characterId: string | null) {
  return useQuery({
    queryKey: spriteKeys.list(characterId ?? ""),
    queryFn: () => spriteApi.list<SpriteInfo[]>(characterId!),
    enabled: !!characterId,
  });
}

export function useUploadSprite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, expression, image }: { characterId: string; expression: string; image: string }) =>
      spriteApi.upload<SpriteInfo>(characterId, { expression, image }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: spriteKeys.list(variables.characterId) });
    },
  });
}

export function useUploadSprites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, sprites }: { characterId: string; sprites: SpriteUploadItem[] }) =>
      spriteApi.bulkUpload<SpriteBulkUploadResult>(characterId, { sprites }),
    onSuccess: (data, variables) => {
      qc.setQueryData(spriteKeys.list(variables.characterId), data.sprites);
    },
  });
}

export function useDeleteSprite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, expression }: { characterId: string; expression: string }) =>
      spriteApi.delete(characterId, expression),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: spriteKeys.list(variables.characterId) });
    },
  });
}

export function useCleanupSavedSprites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      characterId,
      expressions,
      cleanupStrength = 35,
      engine = "auto",
    }: {
      characterId: string;
      expressions?: string[];
      cleanupStrength?: number;
      engine?: SpriteCleanupEngine;
    }) =>
      spriteApi.cleanupSaved<SpriteCleanupResult>(characterId, { expressions, cleanupStrength, engine }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: spriteKeys.list(variables.characterId) });
    },
  });
}

export function useRestoreSpriteCleanupPoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, restorePointId }: { characterId: string; restorePointId: string }) =>
      spriteApi.cleanupRestore<SpriteCleanupRestoreResult>(characterId, { restorePointId }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: spriteKeys.list(variables.characterId) });
    },
  });
}

export function useCharacterGalleryImages(characterId: string | null) {
  return useQuery({
    queryKey: characterKeys.gallery(characterId ?? ""),
    queryFn: () => storageApi.list<CharacterGalleryImage>("character-gallery", { filters: { characterId } }),
    enabled: !!characterId,
    staleTime: 5 * 60_000,
  });
}

export function useUploadCharacterGalleryImage(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      const uploads = await Promise.allSettled(
        files.map((file) => galleryApi.uploadCharacter<CharacterGalleryImage>(characterId, file)),
      );

      const successfulUploads = uploads.filter(
        (result): result is PromiseFulfilledResult<CharacterGalleryImage> => result.status === "fulfilled",
      );

      if (successfulUploads.length !== uploads.length) {
        const failedCount = uploads.length - successfulUploads.length;
        throw new Error(
          failedCount === 1
            ? "One character gallery image failed to upload."
            : `${failedCount} character gallery images failed to upload.`,
        );
      }

      return successfulUploads.map((result) => result.value);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: characterKeys.gallery(characterId) });
    },
  });
}

export function useDeleteCharacterGalleryImage(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => storageApi.delete("character-gallery", imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKeys.gallery(characterId) });
    },
  });
}

// ── Personas ──

export function usePersonas(enabled = true) {
  return useQuery({
    queryKey: characterKeys.personas,
    queryFn: () => storageApi.list<unknown>("personas"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCreatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      comment?: string;
      personality?: string;
      scenario?: string;
      backstory?: string;
      appearance?: string;
      nameColor?: string;
      dialogueColor?: string;
      boxColor?: string;
      trackerCardColors?: string;
      personaStats?: string;
      altDescriptions?: string;
      tags?: string;
      savedStatusOptions?: string;
      avatarCrop?: string;
    }) => storageApi.create("personas", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personas }),
  });
}

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
      nameColor?: string;
      dialogueColor?: string;
      boxColor?: string;
      trackerCardColors?: string;
      personaStats?: string;
      altDescriptions?: string;
      tags?: string;
      savedStatusOptions?: string;
      avatarCrop?: string;
    }) => storageApi.update("personas", id, data),
    onSuccess: (updatedPersona, variables) => {
      qc.setQueryData<unknown[] | undefined>(characterKeys.personas, (old) => {
        if (!Array.isArray(old)) return old;
        const updatedId = (updatedPersona as { id?: string } | null)?.id ?? variables.id;
        if (!updatedId) return old;

        return old.map((p) => {
          const row = p as Record<string, unknown> & { id?: string };
          if (row?.id !== updatedId) return p;
          if (!updatedPersona || typeof updatedPersona !== "object") return p;
          return { ...row, ...(updatedPersona as Record<string, unknown>) };
        });
      });

      qc.invalidateQueries({ queryKey: characterKeys.personas });
    },
  });
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("personas", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personas }),
  });
}

export function useDuplicatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invokeTauri("storage_duplicate", { entity: "personas", id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personas }),
  });
}

export function useActivatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invokeTauri("persona_activate", { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personas }),
  });
}

export function useUploadPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, avatar, filename }: { id: string; avatar: string; filename?: string }) =>
      invokeTauri("persona_avatar_upload", { id, body: { avatar, filename } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personas }),
  });
}

// ── Character Groups ──

export function useCharacterGroups() {
  return useQuery({
    queryKey: characterKeys.groups,
    queryFn: () => storageApi.list<unknown>("character-groups"),
  });
}

export function useCharacterGroup(id: string | null) {
  return useQuery({
    queryKey: characterKeys.groupDetail(id ?? ""),
    queryFn: () => storageApi.get("character-groups", id!),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; characterIds?: string[] }) =>
      storageApi.create("character-groups", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.groups }),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; characterIds?: string[] }) =>
      storageApi.update("character-groups", id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.groups }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("character-groups", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.groups }),
  });
}

// ── Persona Groups ──

export function usePersonaGroups() {
  return useQuery({
    queryKey: characterKeys.personaGroups,
    queryFn: () => storageApi.list<unknown>("persona-groups"),
  });
}

export function useCreatePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; personaIds?: string[] }) =>
      storageApi.create("persona-groups", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personaGroups }),
  });
}

export function useUpdatePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; personaIds?: string[] }) =>
      storageApi.update("persona-groups", id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personaGroups }),
  });
}

export function useDeletePersonaGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("persona-groups", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: characterKeys.personaGroups }),
  });
}
