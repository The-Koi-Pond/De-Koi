import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { galleryKeys } from "../query-keys";
import { galleryApi, imageGenerationApi } from "../../../../shared/api/image-generation-api";
import { resolveGalleryFileUrl } from "../../../../shared/api/local-file-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { runGalleryUploadBatch } from "../../../../shared/lib/gallery-upload";
import { normalizeGeneratedImageResult } from "../../../../engine/contracts/generated-image";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { ChatImage } from "../../../../shared/types/gallery";

function imageCreatedAt(image: ChatImage) {
  const timestamp = typeof image.createdAt === "string" ? Date.parse(image.createdAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function normalizeGalleryImage(image: ChatImage): Promise<ChatImage> {
  const managedUrl = await resolveGalleryFileUrl(image.filename, image.filePath).catch(() => null);
  return {
    ...image,
    url: managedUrl || readTrimmed(image.url) || readTrimmed(image.filePath),
  };
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function imageDimension(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function imageConnectionId(chat: Chat | null): string {
  if (!chat) return "";
  return readTrimmed(chat.metadata?.imageGenConnectionId) || readTrimmed(chat.metadata?.illustrationImageConnectionId);
}

async function listGalleryImagesForChat(chatId: string): Promise<ChatImage[]> {
  const images = await storageApi.list<ChatImage>("gallery", { filters: { chatId } });
  const normalized = await Promise.all(images.map(normalizeGalleryImage));
  return normalized.sort((a, b) => imageCreatedAt(b) - imageCreatedAt(a));
}

export function useGalleryImages(chat: Chat | null) {
  const chatId = chat?.id ?? null;
  return useQuery({
    queryKey: galleryKeys.images(chatId),
    queryFn: () => listGalleryImagesForChat(chatId!),
    enabled: !!chatId,
    retry: false,
  });
}

export function useUploadGalleryImage(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      if (!chatId) return Promise.resolve({ uploaded: [] as ChatImage[], failures: [] });
      return runGalleryUploadBatch(files, (file) => galleryApi.uploadChat<ChatImage>(chatId, file));
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: galleryKeys.images(chatId) });
      }
    },
    meta: { chatId },
  });
}

export function useRegenerateGalleryImage(chat: Chat | null) {
  const queryClient = useQueryClient();
  const activeGalleryQueryKey = galleryKeys.images(chat?.id ?? null);

  return useMutation({
    mutationFn: async (image: ChatImage) => {
      if (!chat?.id) throw new Error("Open a chat before regenerating gallery images.");

      const prompt = readTrimmed(image.prompt);
      if (!prompt) throw new Error("This image does not have a saved prompt to regenerate.");

      const connectionId = imageConnectionId(chat);
      if (!connectionId) throw new Error("Choose an image generation connection in chat settings first.");

      const width = imageDimension(image.width, 1024);
      const height = imageDimension(image.height, 1024);
      const generated = await imageGenerationApi.generate({
        connectionId,
        prompt,
        width,
        height,
      });
      const normalizedImage = normalizeGeneratedImageResult(generated);
      const imageUrl = normalizedImage.dataUrl;
      if (!imageUrl) throw new Error("Image provider returned no image data.");

      const filename = `regenerated_${Date.now()}.${normalizedImage.ext}`;
      return storageApi.create<ChatImage>("gallery", {
        chatId: chat.id,
        filePath: filename,
        filename,
        url: imageUrl,
        prompt,
        provider: generated.provider ?? image.provider ?? "image_generation",
        model: generated.model ?? image.model ?? null,
        width,
        height,
        sourceGalleryId: image.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activeGalleryQueryKey });
    },
    meta: { chatId: chat?.id ?? null },
  });
}

export function useDeleteGalleryImage(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => storageApi.delete("gallery", imageId),
    onSuccess: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: galleryKeys.images(chatId) });
      }
    },
    meta: { chatId },
  });
}
