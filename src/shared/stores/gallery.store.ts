import { create } from "zustand";
import type { ChatImage } from "../types/gallery";

interface GalleryStore {
  pinnedImages: ChatImage[];
  illustratingChatIds: string[];
  pinImage: (image: ChatImage) => void;
  unpinImage: (imageId: string) => void;
  startIllustrating: (chatId: string) => boolean;
  finishIllustrating: (chatId: string) => void;
  runIllustration: <T>(chatId: string, task: () => T | Promise<T>) => Promise<T>;
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  pinnedImages: [],
  illustratingChatIds: [],
  pinImage: (image) =>
    set((state) => ({
      pinnedImages: state.pinnedImages.some((item) => item.id === image.id)
        ? state.pinnedImages
        : [...state.pinnedImages, image],
    })),
  unpinImage: (imageId) =>
    set((state) => ({
      pinnedImages: state.pinnedImages.filter((item) => item.id !== imageId),
    })),
  startIllustrating: (chatId) => {
    const id = chatId.trim();
    if (!id) return false;
    let started = false;
    set((state) => {
      if (state.illustratingChatIds.includes(id)) return state;
      started = true;
      return { illustratingChatIds: [...state.illustratingChatIds, id] };
    });
    return started;
  },
  finishIllustrating: (chatId) => {
    const id = chatId.trim();
    if (!id) return;
    set((state) => ({
      illustratingChatIds: state.illustratingChatIds.filter((item) => item !== id),
    }));
  },
  runIllustration: async (chatId, task) => {
    const id = chatId.trim();
    if (!id) throw new Error("Cannot start illustration without a chat id.");
    if (!get().startIllustrating(id)) throw new Error("Illustration is already generating for this chat.");
    try {
      return await task();
    } finally {
      get().finishIllustrating(id);
    }
  },
}));
