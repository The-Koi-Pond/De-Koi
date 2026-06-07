import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { personaKeys } from "../query-keys";
import { personaApi } from "../../../../shared/api/persona-api";
import { galleryApi } from "../../../../shared/api/image-generation-api";
import { resolveGalleryFileUrl } from "../../../../shared/api/local-file-api";
import type { CustomKind, CustomTagPatch } from "../../../../shared/lib/custom-emoji";
import { storageApi } from "../../../../shared/api/storage-api";
import { runGalleryUploadBatch } from "../../../../shared/lib/gallery-upload";
import { storageCommandsApi } from "../../../../shared/api/storage-commands-api";
import { personaAvatarUrl, type PersonaAvatarSource } from "../lib/persona-avatar-url";
import { PERSONA_SUMMARY_FIELDS } from "../lib/persona-summary-fields";

export { personaKeys } from "../query-keys";

export type PersonaSummary = {
  id: string;
  name?: string;
  comment?: string | null;
  description?: string;
  personality?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
  altDescriptions?: Array<{ active?: boolean; content?: string }>;
  savedStatusOptions?: string | string[] | null;
  tags?: string[];
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: unknown;
  isActive?: string | boolean;
  active?: string | boolean;
  createdAt?: string;
  nameColor?: string;
  dialogueColor?: string;
  boxColor?: string;
};

const PERSONA_SUMMARY_OPTIONS = {
  fields: [...PERSONA_SUMMARY_FIELDS],
};
const PERSONA_CHAT_SUMMARY_OPTIONS = {
  fields: [...PERSONA_SUMMARY_FIELDS, "altDescriptions", "savedStatusOptions"],
};

function personaIsActive(persona: PersonaSummary): boolean {
  return (
    persona.isActive === true || persona.isActive === "true" || persona.active === true || persona.active === "true"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePersonaAvatarFields<T>(persona: T): T {
  if (!isRecord(persona)) return persona;
  const avatarPath = personaAvatarUrl(persona as PersonaAvatarSource);
  const hasAvatarPath = Object.prototype.hasOwnProperty.call(persona, "avatarPath");
  const currentAvatarPath = persona.avatarPath as string | null | undefined;
  if (hasAvatarPath && currentAvatarPath === avatarPath) return persona;
  return { ...persona, avatarPath } as T;
}

async function listPersonas(): Promise<unknown[]> {
  const personas = await storageApi.list<unknown>("personas");
  return personas.map(normalizePersonaAvatarFields);
}

async function getPersona(id: string): Promise<unknown> {
  return normalizePersonaAvatarFields(await storageApi.get<unknown>("personas", id));
}

async function getPersonaSummary(id: string): Promise<PersonaSummary | null> {
  const persona = await storageApi.get<PersonaSummary | null>("personas", id, PERSONA_CHAT_SUMMARY_OPTIONS);
  return persona ? normalizePersonaAvatarFields(persona) : null;
}

async function listPersonaSummaries(): Promise<PersonaSummary[]> {
  const personas = await storageApi.list<PersonaSummary>("personas", PERSONA_SUMMARY_OPTIONS);
  return personas.map(normalizePersonaAvatarFields);
}

async function getActivePersonaSummary(): Promise<PersonaSummary | null> {
  const activePersona = (await listPersonaSummaries()).find(personaIsActive);
  return activePersona?.id ? getPersonaSummary(activePersona.id) : null;
}

export function usePersonas(enabled = true) {
  return useQuery({
    queryKey: personaKeys.list,
    queryFn: listPersonas,
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePersonaSummaries(enabled = true) {
  return useQuery({
    queryKey: personaKeys.summaries,
    queryFn: listPersonaSummaries,
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePersonaSummary(id: string | null, enabled = true) {
  return useQuery({
    queryKey: personaKeys.summaryDetail(id ?? ""),
    queryFn: () => getPersonaSummary(id!),
    enabled: enabled && !!id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePersona(id: string | null, enabled = true) {
  return useQuery({
    queryKey: personaKeys.detail(id ?? ""),
    queryFn: () => getPersona(id!),
    enabled: enabled && !!id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useActivePersonaSummary(enabled = true) {
  return useQuery({
    queryKey: personaKeys.activeSummary,
    queryFn: getActivePersonaSummary,
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function invalidatePersonaCollectionQueries(queryClient: Pick<QueryClient, "invalidateQueries">): void {
  queryClient.invalidateQueries({ queryKey: personaKeys.list, exact: true });
  queryClient.invalidateQueries({ queryKey: personaKeys.summaries, exact: true });
  queryClient.invalidateQueries({ queryKey: personaKeys.activeSummary, exact: true });
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
      personaStats?: unknown;
      altDescriptions?: unknown[];
      tags?: string[];
      savedStatusOptions?: string[];
      avatarCrop?: unknown;
    }) => storageApi.create("personas", data),
    onSuccess: () => {
      invalidatePersonaCollectionQueries(qc);
    },
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
      tags?: string[];
      altDescriptions?: unknown[];
      savedStatusOptions?: string[];
      avatarCrop?: unknown;
      personaStats?: unknown;
    }) => storageApi.update("personas", id, data),
    onSuccess: (updatedPersona, variables) => {
      const normalizedPersona = normalizePersonaAvatarFields(updatedPersona);
      qc.setQueryData(personaKeys.detail(variables.id), normalizedPersona);
      qc.setQueryData<unknown[] | undefined>(personaKeys.list, (old) => {
        if (!Array.isArray(old)) return old;
        const updatedId = (normalizedPersona as { id?: string } | null)?.id ?? variables.id;
        if (!updatedId) return old;

        return old.map((persona) => {
          const row = persona as Record<string, unknown> & { id?: string };
          if (row?.id !== updatedId) return persona;
          if (!normalizedPersona || typeof normalizedPersona !== "object") return persona;
          return { ...row, ...(normalizedPersona as Record<string, unknown>) };
        });
      });

      invalidatePersonaCollectionQueries(qc);
      qc.invalidateQueries({ queryKey: personaKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: personaKeys.summaryDetail(variables.id) });
      qc.invalidateQueries({ queryKey: personaKeys.activeSummary });
    },
  });
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("personas", id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: personaKeys.detail(id) });
      qc.removeQueries({ queryKey: personaKeys.summaryDetail(id) });
      invalidatePersonaCollectionQueries(qc);
      qc.invalidateQueries({ queryKey: personaKeys.activeSummary });
    },
  });
}

export function useDuplicatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageCommandsApi.duplicate("personas", id),
    onSuccess: () => {
      invalidatePersonaCollectionQueries(qc);
    },
  });
}

export function useActivatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => personaApi.activate(id),
    onSuccess: () => {
      invalidatePersonaCollectionQueries(qc);
      qc.invalidateQueries({ queryKey: personaKeys.activeSummary });
    },
  });
}

export function useUploadPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, avatar, filename }: { id: string; avatar: string; filename?: string }) =>
      personaApi.uploadAvatar(id, avatar, filename),
    onSuccess: (_data, variables) => {
      invalidatePersonaCollectionQueries(qc);
      qc.invalidateQueries({ queryKey: personaKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: personaKeys.summaryDetail(variables.id) });
      qc.invalidateQueries({ queryKey: personaKeys.activeSummary });
    },
  });
}

// ── Persona Gallery ──
// Mirrors the character gallery: images live in their own `persona-gallery`
// collection keyed by personaId, so they persist independently of any chat and
// are cleaned up when the persona is deleted (DeletePersonaGallery cleanup).

export interface PersonaGalleryImage {
  id: string;
  personaId: string;
  filePath: string;
  filename?: string | null;
  prompt: string;
  provider: string;
  model: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
  /** Set when this image is tagged as a custom emoji or sticker. */
  customKind?: CustomKind | null;
  customName?: string | null;
}

function readTrimmedValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function normalizePersonaGalleryImage(image: PersonaGalleryImage): Promise<PersonaGalleryImage> {
  const managedUrl = await resolveGalleryFileUrl(image.filename, image.filePath).catch(() => null);
  return {
    ...image,
    url: managedUrl || readTrimmedValue(image.url) || readTrimmedValue(image.filePath),
  };
}

export function usePersonaGalleryImages(personaId: string | null) {
  return useQuery({
    queryKey: personaKeys.gallery(personaId ?? ""),
    queryFn: async () =>
      Promise.all(
        (await storageApi.list<PersonaGalleryImage>("persona-gallery", { filters: { personaId } })).map(
          normalizePersonaGalleryImage,
        ),
      ),
    enabled: !!personaId,
    staleTime: 5 * 60_000,
  });
}

export function useUploadPersonaGalleryImage(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) =>
      runGalleryUploadBatch(files, (file) => galleryApi.uploadPersona<PersonaGalleryImage>(personaId, file)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: personaKeys.gallery(personaId) });
    },
  });
}

export function useDeletePersonaGalleryImage(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => storageApi.delete("persona-gallery", imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personaKeys.gallery(personaId) });
    },
  });
}

export function useTagPersonaGalleryImage(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ imageId, patch }: { imageId: string; patch: CustomTagPatch }) =>
      storageApi.update("persona-gallery", imageId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personaKeys.gallery(personaId) });
    },
  });
}

export function usePersonaGroups(enabled = true) {
  return useQuery({
    queryKey: personaKeys.groups,
    queryFn: () => storageApi.list<unknown>("persona-groups"),
    enabled,
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
