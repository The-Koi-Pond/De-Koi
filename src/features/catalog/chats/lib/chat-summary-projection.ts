export const CHAT_SUMMARY_FIELDS = [
  "id",
  "name",
  "mode",
  "characterIds",
  "groupId",
  "personaId",
  "promptPresetId",
  "connectionId",
  "folderId",
  "sortOrder",
  "connectedChatId",
  "createdAt",
  "updatedAt",
  "metadata",
] as const;

export const CHAT_SUMMARY_METADATA_FIELDS = [
  "autonomousMessages",
  "autonomousUnreadAt",
  "autonomousUnreadCharacterIds",
  "autonomousUnreadCount",
  "branchName",
  "gameId",
  "pinned",
  "tags",
] as const;
