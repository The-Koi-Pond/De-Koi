import type { StorageGateway, StorageListOptions } from "../../engine/capabilities/storage";

type ExtensionStorageMethod = "list" | "get" | "create" | "update" | "delete";
type StorageMutator = Pick<StorageGateway, ExtensionStorageMethod>;

type ExtensionStorageEntity = "plugin-memory";

interface ExtensionStorageApi {
  list<T = unknown>(entity: string, options?: StorageListOptions): Promise<T[]>;
  get<T = unknown>(
    entity: string,
    id: string,
    options?: Pick<StorageListOptions, "fields" | "fieldSelections">,
  ): Promise<T | null>;
  create<T = unknown>(entity: string, value: Record<string, unknown>): Promise<T>;
  update<T = unknown>(entity: string, id: string, patch: Record<string, unknown>): Promise<T>;
  delete(entity: string, id: string): Promise<{ deleted: boolean }>;
}

const EXTENSION_STORAGE_ENTITY: ExtensionStorageEntity = "plugin-memory";

function normalizeStorageEntity(entity: string): string {
  return entity.trim().toLowerCase();
}

function normalizeExtensionId(extensionId: string): string {
  const trimmed = extensionId.trim();
  if (!trimmed) throw new Error("Extension storage requires a stable extension id.");
  return trimmed;
}

function assertExtensionStorageEntityAllowed(entity: string): asserts entity is ExtensionStorageEntity {
  if (normalizeStorageEntity(entity) === EXTENSION_STORAGE_ENTITY) return;
  throw new Error(`Extension storage access to "${entity}" is not allowed.`);
}

function assertScopedMemoryId(extensionId: string, id: string): void {
  if (id.startsWith(`${extensionId}:`)) return;
  throw new Error("Extension storage plugin-memory id is outside this extension namespace.");
}

function scopedPluginMemoryOptions(extensionId: string, options?: StorageListOptions): StorageListOptions {
  return {
    ...options,
    whereIn: undefined,
    filters: { ...(options?.filters ?? {}), pluginId: extensionId },
  };
}

function scopedPluginMemoryCreatePayload(extensionId: string, value: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...value, pluginId: extensionId };
  if (typeof payload.id === "string") {
    assertScopedMemoryId(extensionId, payload.id);
    return payload;
  }
  if (typeof payload.key === "string" && payload.key.trim()) {
    payload.id = `${extensionId}:${encodeURIComponent(payload.key.trim())}`;
    return payload;
  }
  throw new Error("Extension storage plugin-memory create requires a scoped id or non-empty key.");
}

function scopedPluginMemoryUpdatePayload(extensionId: string, patch: Record<string, unknown>): Record<string, unknown> {
  if ("id" in patch) {
    throw new Error("Extension storage plugin-memory update cannot change record id.");
  }
  if ("key" in patch) {
    throw new Error("Extension storage plugin-memory update cannot change record key.");
  }
  return { ...patch, pluginId: extensionId };
}

export function createExtensionStorageApi(storage: StorageMutator, extensionId: string): ExtensionStorageApi {
  const scopedExtensionId = normalizeExtensionId(extensionId);
  return {
    list: async <T = unknown>(entity: string, options?: StorageListOptions) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.list<T>(entity, scopedPluginMemoryOptions(scopedExtensionId, options));
    },
    get: async <T = unknown>(
      entity: string,
      id: string,
      options?: Pick<StorageListOptions, "fields" | "fieldSelections">,
    ) => {
      assertExtensionStorageEntityAllowed(entity);
      assertScopedMemoryId(scopedExtensionId, id);
      return storage.get<T>(entity, id, options);
    },
    create: async <T = unknown>(entity: string, value: Record<string, unknown>) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.create<T>(entity, scopedPluginMemoryCreatePayload(scopedExtensionId, value));
    },
    update: async <T = unknown>(entity: string, id: string, patch: Record<string, unknown>) => {
      assertExtensionStorageEntityAllowed(entity);
      assertScopedMemoryId(scopedExtensionId, id);
      return storage.update<T>(entity, id, scopedPluginMemoryUpdatePayload(scopedExtensionId, patch));
    },
    delete: async (entity: string, id: string) => {
      assertExtensionStorageEntityAllowed(entity);
      assertScopedMemoryId(scopedExtensionId, id);
      return storage.delete(entity, id);
    },
  };
}
