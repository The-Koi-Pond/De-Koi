export const galleryKeys = {
  all: ["gallery"] as const,
  images: (chatId: string | null, scopeChatIds?: readonly string[]) =>
    scopeChatIds
      ? ([...galleryKeys.all, "images", chatId, "scope", scopeChatIds] as const)
      : ([...galleryKeys.all, "images", chatId] as const),
  gameSessions: (gameId: string | null) => [...galleryKeys.all, "game-sessions", gameId] as const,
};

export const globalGalleryKeys = {
  all: ["global-gallery"] as const,
  images: ["global-gallery", "images"] as const,
  folders: ["gallery-folders"] as const,
};
