export const galleryKeys = {
  all: ["gallery"] as const,
  images: (chatId: string | null) => [...galleryKeys.all, "images", chatId] as const,
};

export const globalGalleryKeys = {
  all: ["global-gallery"] as const,
  images: ["global-gallery", "images"] as const,
  folders: ["gallery-folders"] as const,
};
