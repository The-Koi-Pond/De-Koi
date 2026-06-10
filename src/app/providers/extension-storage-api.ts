import type { StorageGateway, StorageListOptions } from "../../engine/capabilities/storage";

type ExtensionStorageMethod = "list" | "get" | "create" | "update" | "delete";
type ExtensionStorageApi = Pick<StorageGateway, ExtensionStorageMethod>;

const PRIVILEGED_EXTENSION_STORAGE_ENTITIES = new Set([
  "agents",
  "agent-memory",
  "agent-runs",
  "app-settings",
  "connections",
  "connection-folders",
  "custom-tools",
  "extensions",
  "prompt-overrides",
]);

function normalizeStorageEntity(entity: string): string {
  return entity.trim().toLowerCase();
}

function isExtensionStorageEntityAllowed(entity: string): boolean {
  return !PRIVILEGED_EXTENSION_STORAGE_ENTITIES.has(normalizeStorageEntity(entity));
}

function assertExtensionStorageEntityAllowed(entity: string): void {
  if (isExtensionStorageEntityAllowed(entity)) return;
  throw new Error(`Extension storage access to "${entity}" is not allowed.`);
}

export function createExtensionStorageApi(storage: ExtensionStorageApi): ExtensionStorageApi {
  return {
    list: async (entity: string, options?: StorageListOptions) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.list(entity, options);
    },
    get: async (entity: string, id: string, options?: Pick<StorageListOptions, "fields" | "fieldSelections">) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.get(entity, id, options);
    },
    create: async (entity: string, value: Record<string, unknown>) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.create(entity, value);
    },
    update: async (entity: string, id: string, patch: Record<string, unknown>) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.update(entity, id, patch);
    },
    delete: async (entity: string, id: string) => {
      assertExtensionStorageEntityAllowed(entity);
      return storage.delete(entity, id);
    },
  };
}
