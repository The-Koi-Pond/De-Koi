export type StorageManagedAssetKind =
  | "avatar"
  | "avatar-thumbnail"
  | "background"
  | "entity-image"
  | "gallery"
  | "lorebook"
  | "sprite";

export type StorageReadJsonField =
  | { name: string; kind: "array" }
  | { name: string; kind: "object"; fallback: "empty-object" | "null" };

export interface StorageInvalidationRule {
  kinds: readonly StorageManagedAssetKind[];
  whenAnyField?: readonly string[];
}

export interface StorageCollectionMetadata {
  genericApi: boolean;
  internalOnly?: true;
  internalReason?: string;
  readJsonFields?: readonly StorageReadJsonField[];
  writeInvalidation?: readonly StorageInvalidationRule[];
  deleteInvalidation?: readonly StorageManagedAssetKind[];
}

const avatarWriteFields = ["avatarPath", "avatarFilePath", "avatarFilename"] as const;
const imageWriteFields = ["image", "imagePath", "imageFilename"] as const;

const STORAGE_COLLECTIONS = {
  characters: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["avatar", "avatar-thumbnail"], whenAnyField: avatarWriteFields }],
    deleteInvalidation: ["avatar", "avatar-thumbnail", "gallery", "sprite"],
  },
  "character-groups": { genericApi: true },
  "character-versions": { genericApi: true },
  personas: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["avatar", "avatar-thumbnail"], whenAnyField: avatarWriteFields }],
    deleteInvalidation: ["avatar", "avatar-thumbnail", "gallery", "sprite"],
  },
  "persona-groups": { genericApi: true },
  lorebooks: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["lorebook"], whenAnyField: imageWriteFields }],
    deleteInvalidation: ["lorebook"],
  },
  "lorebook-library-folders": { genericApi: true },
  "lorebook-entries": {
    genericApi: true,
    writeInvalidation: [{ kinds: ["lorebook"], whenAnyField: imageWriteFields }],
    deleteInvalidation: ["lorebook"],
  },
  "lorebook-folders": { genericApi: true },
  prompts: { genericApi: true },
  "preset-folders": { genericApi: true },
  "prompt-groups": { genericApi: true },
  "prompt-sections": { genericApi: true },
  "prompt-variables": { genericApi: true },
  "prompt-overrides": { genericApi: true },
  "chat-presets": { genericApi: true },
  agents: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["entity-image"], whenAnyField: imageWriteFields }],
    deleteInvalidation: ["entity-image"],
  },
  "agent-runs": { genericApi: true },
  "agent-memory": { genericApi: true },
  themes: { genericApi: true },
  extensions: { genericApi: true },
  "plugin-memory": { genericApi: true },
  "extension-data-retention": { genericApi: true },
  "memory-capture-jobs": {
    genericApi: true,
    readJsonFields: [
      { name: "sourceMessageIds", kind: "array" },
      { name: "sourceMessages", kind: "array" },
    ],
  },
  "canonical-memories": {
    genericApi: true,
    readJsonFields: [
      { name: "scope", kind: "object", fallback: "empty-object" },
      { name: "provenance", kind: "object", fallback: "empty-object" },
      { name: "tags", kind: "array" },
      { name: "payload", kind: "object", fallback: "empty-object" },
    ],
  },
  "memory-index-rows": {
    genericApi: true,
    readJsonFields: [
      { name: "vector", kind: "array" },
      { name: "lexicalTokens", kind: "array" },
    ],
  },
  "music-dj-playlists": {
    genericApi: true,
    readJsonFields: [{ name: "tracks", kind: "array" }],
  },
  connections: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["entity-image"], whenAnyField: imageWriteFields }],
    deleteInvalidation: ["entity-image"],
  },
  "connection-folders": { genericApi: true },
  chats: {
    genericApi: true,
    readJsonFields: [
      { name: "characterIds", kind: "array" },
      { name: "activeLorebookIds", kind: "array" },
      { name: "activeAgentIds", kind: "array" },
      { name: "activeToolIds", kind: "array" },
      { name: "memories", kind: "array" },
      { name: "notes", kind: "array" },
      { name: "metadata", kind: "object", fallback: "empty-object" },
      { name: "gameState", kind: "object", fallback: "null" },
    ],
  },
  "chat-folders": { genericApi: true },
  messages: {
    genericApi: true,
    readJsonFields: [
      { name: "swipes", kind: "array" },
      { name: "images", kind: "array" },
      { name: "attachments", kind: "array" },
      { name: "extra", kind: "object", fallback: "empty-object" },
    ],
    deleteInvalidation: [],
  },
  "deki-sessions": {
    genericApi: true,
    readJsonFields: [{ name: "compaction", kind: "object", fallback: "empty-object" }],
  },
  "deki-messages": {
    genericApi: true,
    readJsonFields: [
      { name: "action", kind: "object", fallback: "null" },
      { name: "actionApplication", kind: "object", fallback: "null" },
      { name: "workspaceTrace", kind: "array" },
      { name: "workspaceHistory", kind: "array" },
    ],
  },
  "message-swipes": {
    genericApi: false,
    internalOnly: true,
    internalReason: "message swipe sidecars are mutated through dedicated message commands",
  },
  "custom-tools": { genericApi: true },
  "regex-scripts": { genericApi: true },
  "app-settings": { genericApi: true },
  gallery: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["gallery"] }],
    deleteInvalidation: ["gallery"],
  },
  "character-gallery": {
    genericApi: true,
    writeInvalidation: [{ kinds: ["gallery"] }],
    deleteInvalidation: ["gallery"],
  },
  "persona-gallery": {
    genericApi: true,
    writeInvalidation: [{ kinds: ["gallery"] }],
    deleteInvalidation: ["gallery"],
  },
  "global-gallery": {
    genericApi: true,
    writeInvalidation: [{ kinds: ["gallery"] }],
    deleteInvalidation: ["gallery"],
  },
  "gallery-folders": { genericApi: true },
  "background-metadata": {
    genericApi: true,
    writeInvalidation: [{ kinds: ["background"] }],
    deleteInvalidation: ["background"],
  },
  sprites: {
    genericApi: true,
    writeInvalidation: [{ kinds: ["sprite"] }],
    deleteInvalidation: ["sprite"],
  },
  "knowledge-sources": { genericApi: true },
  "game-state-snapshots": { genericApi: true },
  "game-checkpoints": { genericApi: true },
} as const satisfies Record<string, StorageCollectionMetadata>;

type StorageCollectionName = keyof typeof STORAGE_COLLECTIONS;

export type StorageEntity = {
  [Collection in StorageCollectionName]: (typeof STORAGE_COLLECTIONS)[Collection]["genericApi"] extends true
    ? Collection
    : never;
}[StorageCollectionName];

export function getStorageCollectionMetadata(entity: StorageEntity): StorageCollectionMetadata {
  return STORAGE_COLLECTIONS[entity];
}
