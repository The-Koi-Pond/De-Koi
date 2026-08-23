import type { StorageEntity } from "./storage-collections";
import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  CanonicalMemoryQuery,
  CanonicalMemoryRecord,
  CanonicalMemorySemanticMatch,
  CanonicalMemorySemanticQuery,
  MemoryLexicalRebuildResult,
  MemoryIndexHealth,
} from "../contracts/types/memory";
import type { ChatMemoryChunk, DaySummaryEntry, WeekSummaryEntry } from "../contracts/types/chat";

export type { StorageEntity } from "./storage-collections";

export interface StorageListBaseOptions {
  orderBy?: string;
  descending?: boolean;
  limit?: number;
  before?: string;
  fields?: string[];
  fieldSelections?: Record<string, string[]>;
  search?: string;
}

type StorageListSelector =
  | { filters?: Record<string, unknown>; whereIn?: never }
  | { whereIn?: { field: string; values: string[] }; filters?: never }
  | { filters?: undefined; whereIn?: undefined };

export type StorageListOptions = StorageListBaseOptions & StorageListSelector;

export type StorageReadOptions = Pick<StorageListOptions, "fields" | "fieldSelections">;
export type ChatMessageListOptions = StorageListBaseOptions & {
  role?: string;
  characterId?: string;
  rawOffset?: number;
};
export type ChatMessageReadOptions = StorageReadOptions;

export type ChatMemoryListOrder = "stored" | "recent";

export interface ListChatMemoriesOptions {
  limit?: number;
  order?: ChatMemoryListOrder;
  excludeRecentMessageIds?: string[];
  excludeRecentStartAt?: string;
}

export interface RefreshChatMemoriesOptions {
  sourceMessageIds?: string[];
}

export interface ChatMemoryCapturePreview {
  version: 1;
  chatId: string;
  sourceMessageIds: string[];
  fingerprint: string;
  candidate: ChatMemoryChunk | null;
}

export interface CommitChatMemoryCaptureInput {
  version: 1;
  chatId: string;
  sourceMessageIds: string[];
  fingerprint: string;
  leaseId: string;
}

export interface CommitChatMemoryCaptureResult {
  operation: "created" | "updated";
  memory: ChatMemoryChunk;
}

export interface AddChatMessageSwipeOptions {
  extra?: Record<string, unknown>;
  activate?: boolean;
  characterId?: string | null;
}

export interface SiblingConversationContextQuery {
  chatId: string;
  characterIds: string[];
  candidateLimit: number;
  maxChats: number;
  messagesPerChat: number;
}

export interface SiblingConversationContextRecord {
  chat: Record<string, unknown>;
  messages: Record<string, unknown>[];
}

export interface StorageImageAttachmentReference {
  type?: string | null;
  url?: string | null;
  data?: string | null;
  imageUrl?: string | null;
  filename?: string | null;
  name?: string | null;
  filePath?: string | null;
  galleryId?: string | null;
}

export type StorageDeleteOptions = {
  force?: boolean;
  deleteMemories?: boolean;
};

export interface MemoryCleanupResult {
  requested: boolean;
  completed: boolean;
  deleted: number;
  retainedShared: number;
  errorCode?: string;
}

export interface StorageDeleteResult {
  deleted: boolean;
  deletedChatIds?: string[];
  memoryCleanup?: MemoryCleanupResult;
}

export interface GenericStorageGateway {
  list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]>;
  get<T = unknown>(entity: StorageEntity, id: string, options?: StorageReadOptions): Promise<T | null>;
  create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T>;
  update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T>;
  delete(entity: StorageEntity, id: string, options?: StorageDeleteOptions): Promise<StorageDeleteResult>;
}

export interface ChatTranscriptPort {
  listChatMessages<T = unknown>(chatId: string, options?: ChatMessageListOptions): Promise<T[]>;
  getChatMessage<T = unknown>(messageId: string, options?: ChatMessageReadOptions): Promise<T | null>;
  createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T>;
  updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T>;
  updateChatMessageContentIfUnchanged?<T = unknown>(
    chatId: string,
    messageId: string,
    expectedContent: string,
    content: string,
  ): Promise<{ updated: boolean; message?: T }>;
  deleteChatMessage(messageId: string): Promise<{ deleted: boolean }>;
  bulkDeleteChatMessages?(chatId: string, messageIds: string[]): Promise<{ deleted: number }>;
  patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T>;
  resolveImageAttachmentDataUrl?(attachment: StorageImageAttachmentReference): Promise<string | null>;
  /**
   * Evict saved generation prompt snapshots from older assistant messages,
   * keeping only the most recent `keepLast` (default 2, matching v1.6.1). Bounds
   * per-chat storage growth; non-destructive to other message data. Optional so
   * lightweight/mock gateways need not implement it.
   */
  evictPromptSnapshots?(chatId: string, keepLast?: number): Promise<{ evicted: number }>;
  addChatMessageSwipe<T = unknown>(
    chatId: string,
    messageId: string,
    content: string,
    options?: AddChatMessageSwipeOptions,
  ): Promise<T>;
  listSiblingConversationContext?<T = SiblingConversationContextRecord>(
    query: SiblingConversationContextQuery,
  ): Promise<T[]>;
}

export interface ChatMetadataPort {
  patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T>;
  /** Atomically merge typed day/week summary deltas; the runtime rejects every other field or entry shape. */
  patchChatSummaries<T = unknown>(chatId: string, patch: ChatSummaryMapsPatch): Promise<T>;
}

export interface ChatSummaryMapsPatch {
  daySummaries?: Record<string, DaySummaryEntry>;
  weekSummaries?: Record<string, WeekSummaryEntry>;
}

export interface TrackerSnapshotTargetQuery {
  messageId: string;
  swipeIndex: number;
}

export interface TrackerSnapshotSelectionQuery {
  preferLatestVisible?: boolean;
  visibleAnchor?: TrackerSnapshotTargetQuery | null;
  excludeMessageId?: string | null;
  fallbackTargets?: TrackerSnapshotTargetQuery[] | null;
}

export interface StorageGateway extends GenericStorageGateway, ChatTranscriptPort, ChatMetadataPort {
  acquireMemoryCaptureWorker?(workerId: string, leaseId?: string): Promise<string | null>;
  releaseMemoryCaptureWorker?(workerId: string, leaseId: string): Promise<void>;
  updateMemoryCaptureJob?(
    leaseId: string,
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  createMemoryCaptureMemory?(leaseId: string, body: CanonicalMemoryInput): Promise<CanonicalMemoryRecord>;
  updateMemoryCaptureMemory?(
    leaseId: string,
    memoryId: string,
    patch: CanonicalMemoryPatch,
  ): Promise<CanonicalMemoryRecord>;
  patchMemoryCaptureMessageExtra?<T = unknown>(
    leaseId: string,
    messageId: string,
    patch: Record<string, unknown>,
  ): Promise<T>;
  rebuildMemoryCaptureIndex?(leaseId: string, body?: CanonicalMemoryQuery): Promise<MemoryLexicalRebuildResult>;
  createMemory?(body: CanonicalMemoryInput): Promise<CanonicalMemoryRecord>;
  updateMemory?(memoryId: string, patch: CanonicalMemoryPatch): Promise<CanonicalMemoryRecord>;
  queryMemories?(body?: CanonicalMemoryQuery): Promise<CanonicalMemoryRecord[]>;
  queryMemoriesBatch?(queries: CanonicalMemoryQuery[]): Promise<CanonicalMemoryRecord[]>;
  querySemanticMemories?(body: CanonicalMemorySemanticQuery): Promise<CanonicalMemorySemanticMatch[]>;
  queryMemoryIndex?(body?: CanonicalMemoryQuery): Promise<CanonicalMemoryRecord[]>;
  queryMemoryIndexBatch?(queries: CanonicalMemoryQuery[]): Promise<CanonicalMemoryRecord[]>;
  rebuildMemoryIndex?(body?: CanonicalMemoryQuery): Promise<MemoryLexicalRebuildResult>;
  memoryIndexHealth?(): Promise<MemoryIndexHealth>;
  listChatMemories<T = unknown>(chatId: string, options?: ListChatMemoriesOptions): Promise<T[]>;
  refreshChatMemories?<T = unknown>(chatId: string, options?: RefreshChatMemoriesOptions): Promise<T>;
  previewChatMemoryCapture?(chatId: string, sourceMessageIds: string[]): Promise<ChatMemoryCapturePreview>;
  commitChatMemoryCapture?(body: CommitChatMemoryCaptureInput): Promise<CommitChatMemoryCaptureResult>;
  getWorldState<T = unknown>(chatId: string): Promise<T | null>;
  getTrackerSnapshot?<T = unknown>(chatId: string, target: TrackerSnapshotTargetQuery): Promise<T | null>;
  selectTrackerSnapshot?<T = unknown>(chatId: string, query: TrackerSnapshotSelectionQuery): Promise<T | null>;
  saveTrackerSnapshot<T = unknown>(chatId: string, snapshot: Record<string, unknown>): Promise<T>;
  listLorebookEntries<T = unknown>(lorebookId: string): Promise<T[]>;
  listLorebookEntriesByLorebookIds?<T = unknown>(lorebookIds: string[]): Promise<T[]>;
  createLorebookEntries<T = unknown>(lorebookId: string, entries: Array<Record<string, unknown>>): Promise<T[]>;
  knowledgeSourceText?<T = unknown>(id: string): Promise<T | null>;
  promptFull<T = unknown>(presetId: string): Promise<T | null>;
}
