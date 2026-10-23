export const roleplayWorldTickKeys = {
  all: ["roleplay-world-tick"] as const,
  state: (chatId: string) => [...roleplayWorldTickKeys.all, "state", chatId] as const,
};
