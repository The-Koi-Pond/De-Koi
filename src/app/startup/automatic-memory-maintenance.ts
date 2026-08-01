import { useEffect } from "react";

import type { StorageGateway } from "../../engine/capabilities/storage";
import type { MemoryCleanupScope, MemoryCleanupTarget } from "../../engine/contracts/types/memory-maintenance";
import {
  cancelAutomaticMemoryMaintenanceQueueProcessing,
  enqueueAutomaticMemoryMaintenanceTarget,
  scheduleAutomaticMemoryMaintenanceQueueProcessing,
  type AutomaticMemoryMaintenanceDependencies,
} from "../../engine/generation/automatic-memory-maintenance-queue";
import { selectBackgroundTextConnection } from "../../engine/generation/background-llm-connection";
import { parseRecord, readString, type JsonRecord } from "../../engine/generation/runtime-records";
import { connectionCatalogApi } from "../../shared/api/connection-catalog-api";
import { llmApi } from "../../shared/api/llm-api";
import { memoryMaintenanceApi } from "../../shared/api/memory-maintenance-api";
import { storageApi } from "../../shared/api/storage-api";

const SWEEP_ID = "memory-maintenance-sweep-v1";
const JOBS_COLLECTION = "memory-maintenance-jobs" as const;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface AutomaticMemoryMaintenanceSeedResult {
  chatTargets: number;
  canonicalTargets: number;
  complete: boolean;
}

function cursor(row: JsonRecord): string {
  const id = readString(row.id).trim();
  return `${id}|${id}`;
}

function canonicalScope(row: JsonRecord): MemoryCleanupScope | null {
  const scope = parseRecord(row.scope);
  const kind = readString(scope.kind).trim();
  const id = readString(scope.id).trim();
  if (!["chat", "scene", "character"].includes(kind) || !id) return null;
  return { kind: kind as MemoryCleanupScope["kind"], id };
}

function chatScope(row: JsonRecord): MemoryCleanupScope | null {
  const id = readString(row.id).trim();
  if (!id) return null;
  const sceneId = readString(row.sceneId ?? row.activeSceneId).trim();
  return { kind: sceneId ? "scene" : "chat", id };
}

async function ensureSweep(storage: StorageGateway, now: string): Promise<JsonRecord> {
  const existing = await storage.get<JsonRecord>(JOBS_COLLECTION, SWEEP_ID).catch(() => null);
  if (existing) return existing;
  return storage.create<JsonRecord>(JOBS_COLLECTION, {
    id: SWEEP_ID,
    recordType: "sweep",
    policyVersion: 1,
    status: "pending",
    chatBefore: null,
    canonicalBefore: null,
    chatComplete: false,
    canonicalComplete: false,
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedAutomaticMemoryMaintenanceJobs(
  storage: StorageGateway,
  options: { pageSize?: number; now?: string } = {},
): Promise<AutomaticMemoryMaintenanceSeedResult> {
  const now = options.now ?? new Date().toISOString();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)));
  let sweep = await ensureSweep(storage, now);
  let chatTargets = 0;
  let canonicalTargets = 0;

  if (sweep.chatComplete !== true) {
    const chats = await storage.list<JsonRecord>("chats", {
      orderBy: "id",
      limit: pageSize,
      ...(readString(sweep.chatBefore).trim() ? { before: readString(sweep.chatBefore).trim() } : {}),
      fields: ["id", "sceneId", "activeSceneId"],
    });
    for (const row of chats) {
      const scope = chatScope(row);
      if (!scope) continue;
      await enqueueAutomaticMemoryMaintenanceTarget(storage, { store: "chat", scope }, now);
      chatTargets += 1;
    }
    const chatComplete = chats.length < pageSize;
    sweep = await storage.update<JsonRecord>(JOBS_COLLECTION, SWEEP_ID, {
      chatBefore: chats.length > 0 ? cursor(chats[chats.length - 1]) : sweep.chatBefore,
      chatComplete,
      updatedAt: now,
    });
  }

  if (sweep.canonicalComplete !== true) {
    const memories = await storage.list<JsonRecord>("canonical-memories", {
      orderBy: "id",
      limit: pageSize,
      ...(readString(sweep.canonicalBefore).trim() ? { before: readString(sweep.canonicalBefore).trim() } : {}),
      fields: ["id", "scope"],
    });
    const scopes = new Map<string, MemoryCleanupScope>();
    for (const row of memories) {
      const scope = canonicalScope(row);
      if (scope) scopes.set(`${scope.kind}:${scope.id}`, scope);
    }
    for (const scope of scopes.values()) {
      await enqueueAutomaticMemoryMaintenanceTarget(storage, { store: "canonical", scope }, now);
      canonicalTargets += 1;
    }
    const canonicalComplete = memories.length < pageSize;
    sweep = await storage.update<JsonRecord>(JOBS_COLLECTION, SWEEP_ID, {
      canonicalBefore: memories.length > 0 ? cursor(memories[memories.length - 1]) : sweep.canonicalBefore,
      canonicalComplete,
      status: sweep.chatComplete === true && canonicalComplete ? "completed" : "pending",
      updatedAt: now,
    });
  }

  const complete = sweep.chatComplete === true && sweep.canonicalComplete === true;
  if (complete && readString(sweep.status).trim() !== "completed") {
    await storage.update(JOBS_COLLECTION, SWEEP_ID, { status: "completed", updatedAt: now });
  }
  return { chatTargets, canonicalTargets, complete };
}

export async function resolveAutomaticMemoryMaintenanceConnectionId(
  storage: StorageGateway,
  target: MemoryCleanupTarget,
  listConnections: () => Promise<JsonRecord[]> = async () =>
    (await connectionCatalogApi.listAvailable()).map((connection) => ({ ...connection })),
): Promise<string> {
  let fallbackConnectionId: string | null = null;
  if (target.scope.kind === "chat" || target.scope.kind === "scene") {
    const chat = (await storage.get<JsonRecord>("chats", target.scope.id)) ?? {};
    fallbackConnectionId = readString(chat.connectionId).trim() || null;
  }
  const connection = selectBackgroundTextConnection(await listConnections(), fallbackConnectionId);
  if (!connection) throw new Error("No text connection is available");
  return readString(connection.id).trim();
}

function dependencies(): AutomaticMemoryMaintenanceDependencies {
  return {
    storage: storageApi,
    llm: llmApi,
    maintenance: memoryMaintenanceApi,
    resolveConnectionId: (target) => resolveAutomaticMemoryMaintenanceConnectionId(storageApi, target),
  };
}

function requestIdleWork(callback: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1_800 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(id);
}

export function useAutomaticMemoryMaintenance(): void {
  useEffect(() => {
    const worker = dependencies();
    let disposed = false;
    let cancelIdle = () => {};
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleDiscovery = () => {
      cancelIdle = requestIdleWork(() => {
        void seedAutomaticMemoryMaintenanceJobs(worker.storage)
          .then((result) => {
            if (disposed) return;
            scheduleAutomaticMemoryMaintenanceQueueProcessing(worker);
            if (!result.complete) scheduleDiscovery();
          })
          .catch(() => {
            if (disposed) return;
            scheduleAutomaticMemoryMaintenanceQueueProcessing(worker);
            retryTimer = setTimeout(scheduleDiscovery, 30_000);
          });
      });
    };
    scheduleAutomaticMemoryMaintenanceQueueProcessing(worker);
    scheduleDiscovery();
    return () => {
      disposed = true;
      cancelIdle();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      cancelAutomaticMemoryMaintenanceQueueProcessing(worker.storage);
    };
  }, []);
}

export function AutomaticMemoryMaintenanceHost() {
  useAutomaticMemoryMaintenance();
  return null;
}
