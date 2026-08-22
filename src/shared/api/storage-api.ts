import type {
  AddChatMessageSwipeOptions,
  ChatMetadataPort,
  ChatSummaryMapsPatch,
  ChatTranscriptPort,
  ListChatMemoriesOptions,
  RefreshChatMemoriesOptions,
  StorageImageAttachmentReference,
  StorageEntity,
  StorageGateway,
  StorageDeleteOptions,
  StorageListOptions,
  TrackerSnapshotSelectionQuery,
  TrackerSnapshotTargetQuery,
} from "../../engine/capabilities/storage";
import {
  getStorageCollectionMetadata,
  type StorageInvalidationRule,
  type StorageManagedAssetKind,
  type StorageReadJsonField,
} from "../../engine/capabilities/storage-collections";
import { collapseExcessBlankLines } from "../../engine/shared/text/newlines";
import { ApiError } from "./api-errors";
import {
  invalidateRemoteManagedAssetObjectUrlsAfter,
  resolveGalleryFileUrl,
  type RemoteManagedAssetKind,
} from "./local-file-api";
import { blobToDataUrl } from "../lib/url-blob";
import { chatCommandApi } from "./chat-command-api";
import { canonicalMemoryApi } from "./canonical-memory-api";
import { memoryCaptureApi } from "./memory-capture-api";
import { invokeTauri } from "./tauri-client";
import { trackerSnapshotApi, type TrackerSnapshotInput } from "./tracker-snapshot-api";
import { urlBinaryApi } from "./url-binary-api";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeArrayField(record: Record<string, unknown>, field: string): void {
  const parsed = parseStoredJson(record[field]);
  if (Array.isArray(parsed)) {
    record[field] = parsed;
  } else if (field in record) {
    record[field] = [];
  }
}

function normalizeObjectField(
  record: Record<string, unknown>,
  field: string,
  fallback: Record<string, unknown> | null,
): void {
  const parsed = parseStoredJson(record[field]);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    record[field] = parsed as Record<string, unknown>;
  } else if (field in record || fallback !== null) {
    record[field] = fallback;
  }
}

function storageReadFieldFallback(field: StorageReadJsonField): Record<string, unknown> | null {
  return field.kind === "object" && field.fallback === "empty-object" ? {} : null;
}

function normalizeStorageRecord(entity: StorageEntity, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };

  for (const field of getStorageCollectionMetadata(entity).readJsonFields ?? []) {
    if (field.kind === "array") {
      normalizeArrayField(record, field.name);
    } else {
      normalizeObjectField(record, field.name, storageReadFieldFallback(field));
    }
  }

  return record;
}

function normalizeSwipeContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const swipe = { ...(value as Record<string, unknown>) };
  if (typeof swipe.content === "string") {
    swipe.content = collapseExcessBlankLines(swipe.content);
  }
  return swipe;
}

function normalizeMessageWrite(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  if (typeof next.content === "string") {
    next.content = collapseExcessBlankLines(next.content);
  }
  if (Array.isArray(next.swipes)) {
    next.swipes = next.swipes.map(normalizeSwipeContent);
  }
  return next;
}

function normalizeStorageWrite(_entity: StorageEntity, value: Record<string, unknown>): Record<string, unknown> {
  return value;
}

function storageWriteInvalidationKinds(
  entity: StorageEntity,
  value?: Record<string, unknown>,
): RemoteManagedAssetKind[] {
  return storageInvalidationKinds(getStorageCollectionMetadata(entity).writeInvalidation, value);
}

function storageDeleteInvalidationKinds(entity: StorageEntity): RemoteManagedAssetKind[] {
  return toRemoteManagedAssetKinds(getStorageCollectionMetadata(entity).deleteInvalidation ?? []);
}

function storageInvalidationKinds(
  rules: readonly StorageInvalidationRule[] | undefined,
  value?: Record<string, unknown>,
): RemoteManagedAssetKind[] {
  const kinds = new Set<StorageManagedAssetKind>();
  for (const rule of rules ?? []) {
    if (rule.whenAnyField && (!value || !rule.whenAnyField.some((field) => field in value))) continue;
    for (const kind of rule.kinds) kinds.add(kind);
  }
  return toRemoteManagedAssetKinds(Array.from(kinds));
}

function toRemoteManagedAssetKinds(kinds: readonly StorageManagedAssetKind[]): RemoteManagedAssetKind[] {
  return [...kinds] as RemoteManagedAssetKind[];
}

function normalizeStorageReadResult(entity: StorageEntity, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStorageRecord(entity, item));
  return normalizeStorageRecord(entity, value);
}

function normalizePromptPresetBundleResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const bundle = value as Record<string, unknown>;
  return {
    ...bundle,
    preset: normalizeStorageReadResult("prompts", bundle.preset),
    sections: normalizeStorageReadResult("prompt-sections", bundle.sections),
    groups: normalizeStorageReadResult("prompt-groups", bundle.groups),
    choiceBlocks: normalizeStorageReadResult("prompt-variables", bundle.choiceBlocks),
  };
}

function messageExtraRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      throw new ApiError("Message extra must be a JSON object", 400);
    }
    throw new ApiError("Message extra must be a JSON object", 400);
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ApiError("Message extra must be a JSON object", 400);
}

function messageExtraDefaults(role: unknown, value: unknown): Record<string, unknown> {
  return {
    displayText: null,
    isGenerated: role !== "user",
    tokenCount: null,
    generationInfo: null,
    ...messageExtraRecord(value),
  };
}

function chatMessageDefaults(chatId: string, value: Record<string, unknown>): Record<string, unknown> {
  const role = typeof value.role === "string" ? value.role : "user";
  const content = typeof value.content === "string" ? value.content : "";
  const extra = messageExtraDefaults(role, value.extra);
  const swipes = Array.isArray(value.swipes) && value.swipes.length > 0 ? value.swipes : [{ content, extra }];
  const requestedActiveIndex =
    typeof value.activeSwipeIndex === "number" && Number.isFinite(value.activeSwipeIndex)
      ? Math.max(0, Math.trunc(value.activeSwipeIndex))
      : 0;
  const activeSwipeIndex = Math.min(requestedActiveIndex, swipes.length - 1);
  return {
    ...value,
    chatId,
    role,
    content,
    extra,
    activeSwipeIndex,
    swipes,
  };
}

function chatMessageSwipeBody(content: string, options?: AddChatMessageSwipeOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { content };
  if (options?.extra) body.extra = options.extra;
  if (typeof options?.activate === "boolean") body.activate = options.activate;
  if (Object.prototype.hasOwnProperty.call(options ?? {}, "characterId")) {
    body.characterId = options?.characterId ?? null;
  }
  return body;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inlineImageDataUrl(value: unknown): string {
  const text = textField(value);
  return text.toLowerCase().startsWith("data:image/") ? text : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadImageUrlAsDataUrl(
  url: string,
  fallbackMimeType = "image/png",
  sourceLabel = "image attachment",
): Promise<string | null> {
  if (!url) return null;
  const inline = inlineImageDataUrl(url);
  if (inline) return inline;
  try {
    const blob = await urlBinaryApi.load(url, fallbackMimeType);
    const mimeType = textField(blob.type).toLowerCase();
    if (mimeType && !mimeType.startsWith("image/")) {
      throw new Error(`${sourceLabel} resolved to ${mimeType}, not an image.`);
    }
    return blobToDataUrl(blob, "URL binary request failed to read the file.");
  } catch (error) {
    throw new Error(`Failed to load ${sourceLabel}: ${errorMessage(error)}`);
  }
}

async function loadResolvedGalleryFileDataUrl(
  filename: string,
  filePath: string,
  sourceLabel: string,
  errors: string[],
): Promise<string | null> {
  if (!filename && !filePath) return null;
  let resolvedUrl: string | null = null;
  try {
    resolvedUrl = await resolveGalleryFileUrl(filename, filePath);
  } catch (error) {
    errors.push(`failed to resolve ${sourceLabel}: ${errorMessage(error)}`);
    return null;
  }
  if (!resolvedUrl) {
    errors.push(`could not resolve ${sourceLabel}`);
    return null;
  }
  try {
    return await loadImageUrlAsDataUrl(resolvedUrl, "image/png", sourceLabel);
  } catch (error) {
    errors.push(errorMessage(error));
    return null;
  }
}

async function galleryImageDataUrl(gallery: unknown, galleryId: string): Promise<string | null> {
  if (!gallery || typeof gallery !== "object" || Array.isArray(gallery)) return null;
  const record = gallery as Record<string, unknown>;
  const errors: string[] = [];
  const url = textField(record.url);
  if (url) {
    try {
      const urlData = await loadImageUrlAsDataUrl(url, "image/png", `gallery image ${galleryId} url`);
      if (urlData) return urlData;
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  const fileData = await loadResolvedGalleryFileDataUrl(
    textField(record.filename),
    textField(record.filePath),
    `gallery image ${galleryId} file`,
    errors,
  );
  if (fileData) return fileData;
  if (errors.length) throw new Error(errors.join("; "));
  return null;
}

async function resolveImageAttachmentDataUrl(attachment: StorageImageAttachmentReference): Promise<string | null> {
  const inline =
    inlineImageDataUrl(attachment.data) ||
    inlineImageDataUrl(attachment.url) ||
    inlineImageDataUrl(attachment.imageUrl);
  if (inline) return inline;

  const galleryId = textField(attachment.galleryId);
  if (galleryId) {
    let gallery: Record<string, unknown> | null = null;
    try {
      gallery = await storageApi.get<Record<string, unknown>>("gallery", galleryId);
    } catch (error) {
      throw new Error(`Failed to load image attachment gallery ${galleryId}: ${errorMessage(error)}`);
    }
    if (!gallery) throw new Error(`Image attachment gallery ${galleryId} was not found.`);
    const galleryData = await galleryImageDataUrl(gallery, galleryId);
    if (galleryData) return galleryData;
    throw new Error(`Image attachment gallery ${galleryId} does not contain a readable image.`);
  }

  const directUrl = textField(attachment.url) || textField(attachment.imageUrl);
  const errors: string[] = [];
  if (directUrl) {
    try {
      const urlData = await loadImageUrlAsDataUrl(directUrl, "image/png", "image attachment url");
      if (urlData) return urlData;
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  const filename = textField(attachment.filename);
  const filePath = textField(attachment.filePath);
  const fileData = await loadResolvedGalleryFileDataUrl(filename, filePath, "image attachment file", errors);
  if (fileData) return fileData;
  if (errors.length) throw new Error(errors.join("; "));
  return null;
}

const DURABLE_STORAGE_REQUEST_OPTIONS = { timeoutMs: null } as const;

export const storageApi: StorageGateway = {
  acquireMemoryCaptureWorker: (workerId, leaseId) => memoryCaptureApi.acquireWorker(workerId, leaseId),
  releaseMemoryCaptureWorker: (workerId, leaseId) => memoryCaptureApi.releaseWorker(workerId, leaseId),
  updateMemoryCaptureJob: (leaseId, jobId, patch) => memoryCaptureApi.updateJob(leaseId, jobId, patch),
  createMemoryCaptureMemory: (leaseId, body) => memoryCaptureApi.createMemory(leaseId, body),
  updateMemoryCaptureMemory: (leaseId, memoryId, patch) => memoryCaptureApi.updateMemory(leaseId, memoryId, patch),
  patchMemoryCaptureMessageExtra: (leaseId, messageId, patch) =>
    memoryCaptureApi.patchMessageExtra(leaseId, messageId, patch),
  rebuildMemoryCaptureIndex: (leaseId, body) => memoryCaptureApi.rebuildIndex(leaseId, body),
  createMemory: (body) => canonicalMemoryApi.create(body),
  updateMemory: (memoryId, patch) => canonicalMemoryApi.update(memoryId, patch),
  queryMemories: (body) => canonicalMemoryApi.query(body),
  queryMemoriesBatch: (queries) => canonicalMemoryApi.queryBatch(queries),
  querySemanticMemories: (body) => canonicalMemoryApi.querySemantic(body),
  queryMemoryIndex: (body) => canonicalMemoryApi.index.query(body),
  queryMemoryIndexBatch: (queries) => canonicalMemoryApi.index.queryBatch(queries),
  rebuildMemoryIndex: (body) => canonicalMemoryApi.index.rebuildLexical(body),
  memoryIndexHealth: () => canonicalMemoryApi.index.health(),
  list: async (entity: StorageEntity, options?: StorageListOptions) =>
    normalizeStorageReadResult(
      entity,
      await invokeTauri("storage_list", {
        entity,
        options: options ?? null,
      }),
    ) as never,
  get: async (entity: StorageEntity, id: string, options?: Pick<StorageListOptions, "fields" | "fieldSelections">) =>
    normalizeStorageReadResult(
      entity,
      await invokeTauri("storage_get", {
        entity,
        id,
        options: options ?? null,
      }),
    ) as never,
  create: async (entity: StorageEntity, value: Record<string, unknown>) => {
    const result = await invalidateRemoteManagedAssetObjectUrlsAfter(
      invokeTauri(
        "storage_create",
        {
          entity,
          value: normalizeStorageWrite(entity, value),
        },
        DURABLE_STORAGE_REQUEST_OPTIONS,
      ),
      storageWriteInvalidationKinds(entity, value),
    );
    return normalizeStorageReadResult(entity, result) as never;
  },
  update: async (entity: StorageEntity, id: string, patch: Record<string, unknown>) => {
    const result = await invalidateRemoteManagedAssetObjectUrlsAfter(
      invokeTauri(
        "storage_update",
        {
          entity,
          id,
          patch: normalizeStorageWrite(entity, patch),
        },
        DURABLE_STORAGE_REQUEST_OPTIONS,
      ),
      storageWriteInvalidationKinds(entity, patch),
    );
    return normalizeStorageReadResult(entity, result) as never;
  },
  delete: (entity: StorageEntity, id: string, options?: StorageDeleteOptions) =>
    invalidateRemoteManagedAssetObjectUrlsAfter(
      invokeTauri(
        "storage_delete",
        {
          entity,
          id,
          ...(options?.force === undefined ? {} : { force: options.force }),
          ...(options?.deleteMemories === undefined ? {} : { deleteMemories: options.deleteMemories }),
        },
        DURABLE_STORAGE_REQUEST_OPTIONS,
      ),
      storageDeleteInvalidationKinds(entity),
    ),
  listChatMessages: (chatId, options) => {
    const { role, characterId, ...listOptions } = options ?? {};
    return storageApi.list("messages", {
      ...listOptions,
      filters: {
        chatId,
        ...(role ? { role } : {}),
        ...(characterId ? { characterId } : {}),
      },
    });
  },
  listSiblingConversationContext: (query) => invokeTauri("chat_sibling_conversation_context", { body: query }),
  getChatMessage: (messageId, options) => storageApi.get("messages", messageId, options),
  createChatMessage: (chatId, value) => storageApi.create("messages", chatMessageDefaults(chatId, value)),
  updateChatMessage: async <T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> => {
    return storageApi.update<T>("messages", messageId, normalizeMessageWrite(patch));
  },
  updateChatMessageContentIfUnchanged: async (chatId, messageId, expectedContent, content) => {
    const result = (await invokeTauri("chat_message_update_content_if_unchanged", {
      chatId,
      messageId,
      expectedContent,
      content: collapseExcessBlankLines(content),
    })) as { updated?: boolean; message?: unknown } | null;
    const message = result?.message ? normalizeStorageReadResult("messages", result.message) : undefined;
    return {
      updated: result?.updated === true,
      ...(message === undefined ? {} : { message }),
    } as never;
  },
  deleteChatMessage: (messageId) => storageApi.delete("messages", messageId),
  bulkDeleteChatMessages: (chatId, messageIds) => chatCommandApi.bulkDeleteMessages(chatId, messageIds),
  patchChatMessageExtra: async (messageId, patch) => {
    const message = await storageApi.get<Record<string, unknown>>("messages", messageId, { fields: ["extra"] });
    if (!message) throw new ApiError(`Message ${messageId} was not found`, 404);
    return storageApi.update("messages", messageId, {
      extra: { ...asRecord(message.extra), ...patch },
    });
  },
  resolveImageAttachmentDataUrl,
  addChatMessageSwipe: (chatId, messageId, content, options) =>
    invokeTauri(
      "chat_message_add_swipe",
      {
        chatId,
        messageId,
        body: chatMessageSwipeBody(content, options),
      },
      { timeoutMs: null },
    ),
  evictPromptSnapshots: (chatId, keepLast) =>
    invokeTauri("chat_evict_prompt_snapshots", { chatId, keepLast }) as Promise<{ evicted: number }>,
  patchChatMetadata: (chatId, patch) => storageApi.update("chats", chatId, { metadata: patch }),
  patchChatSummaries: <T = unknown>(chatId: string, patch: ChatSummaryMapsPatch) =>
    invokeTauri<T>("chat_summary_maps_patch", { chatId, patch }, { timeoutMs: null }),
  listChatMemories: <T = unknown>(chatId: string, options?: ListChatMemoriesOptions) =>
    chatCommandApi.memoriesList<T[]>(chatId, options),
  refreshChatMemories: (chatId, options?: RefreshChatMemoriesOptions) =>
    invokeTauri("chat_memories_refresh", { chatId, sourceMessageIds: options?.sourceMessageIds }),
  previewChatMemoryCapture: (chatId, sourceMessageIds) => chatCommandApi.memoryCapturePreview(chatId, sourceMessageIds),
  commitChatMemoryCapture: (body) => chatCommandApi.memoryCaptureCommit(body),
  getWorldState: async (chatId) => {
    const chat = await storageApi.get<Record<string, unknown>>("chats", chatId);
    return (chat?.gameState as never) ?? null;
  },
  getTrackerSnapshot: <T = unknown>(chatId: string, target: TrackerSnapshotTargetQuery) =>
    trackerSnapshotApi.get(chatId, target) as Promise<T | null>,
  selectTrackerSnapshot: <T = unknown>(chatId: string, query: TrackerSnapshotSelectionQuery) =>
    trackerSnapshotApi.select(chatId, query) as Promise<T | null>,
  saveTrackerSnapshot: <T = unknown>(chatId: string, snapshot: Record<string, unknown>) =>
    trackerSnapshotApi.save(chatId, snapshot as unknown as TrackerSnapshotInput) as Promise<T>,
  listLorebookEntries: (lorebookId) => storageApi.list("lorebook-entries", { filters: { lorebookId } }),
  listLorebookEntriesByLorebookIds: (lorebookIds) =>
    lorebookIds.length
      ? invokeTauri("lorebook_entries_list_by_lorebook_ids", {
          lorebookIds: Array.from(new Set(lorebookIds.map((id) => id.trim()).filter(Boolean))),
        })
      : Promise.resolve([]),
  createLorebookEntries: async (lorebookId, entries) =>
    Promise.all(entries.map((entry) => storageApi.create("lorebook-entries", { ...entry, lorebookId }))) as Promise<
      never[]
    >,
  knowledgeSourceText: <T = unknown>(id: string) => invokeTauri<T>("knowledge_source_text", { id }),
  promptFull: async (presetId) =>
    normalizePromptPresetBundleResult(
      await invokeTauri("prompt_preset_bundle", {
        presetId,
      }),
    ) as never,
};

export const chatTranscriptStorageApi: ChatTranscriptPort = {
  listChatMessages: (...args) => storageApi.listChatMessages(...args),
  getChatMessage: (...args) => storageApi.getChatMessage(...args),
  createChatMessage: (...args) => storageApi.createChatMessage(...args),
  updateChatMessage: (...args) => storageApi.updateChatMessage(...args),
  updateChatMessageContentIfUnchanged: (...args) => storageApi.updateChatMessageContentIfUnchanged?.(...args) as never,
  deleteChatMessage: (...args) => storageApi.deleteChatMessage(...args),
  bulkDeleteChatMessages: (...args) => chatCommandApi.bulkDeleteMessages(...args),
  patchChatMessageExtra: (...args) => storageApi.patchChatMessageExtra(...args),
  resolveImageAttachmentDataUrl: (...args) => storageApi.resolveImageAttachmentDataUrl?.(...args) as never,
  evictPromptSnapshots: (...args) => storageApi.evictPromptSnapshots?.(...args) as never,
  addChatMessageSwipe: (...args) => storageApi.addChatMessageSwipe(...args),
};

export const chatMetadataStorageApi: ChatMetadataPort = {
  patchChatMetadata: (...args) => storageApi.patchChatMetadata(...args),
  patchChatSummaries: (...args) => storageApi.patchChatSummaries(...args),
};
