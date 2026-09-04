export const roleplayContinuityDirectorKeys = {
  all: ["roleplay-continuity-director"] as const,
  state: (chatId: string) => [...roleplayContinuityDirectorKeys.all, "state", chatId] as const,
};
