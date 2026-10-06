import { LOCAL_SIDECAR_CONNECTION_ID, type LocalSidecarStatusResponse } from "../../engine/contracts/types/sidecar";
import { filterLanguageGenerationConnections } from "../lib/connection-filters";
import { localSidecarApi } from "./local-sidecar-api";
import { storageApi } from "./storage-api";

export type AvailableConnectionSummary = {
  id: string;
  name: string;
  provider: string;
  synthetic?: boolean;
  model?: string | null;
  baseUrl?: string | null;
  maxContext?: number | null;
  capabilities?: Record<string, unknown> | null;
  providerMetadata?: Record<string, unknown> | null;
  capabilitiesStale?: boolean | null;
  folderId?: string | null;
  imagePath?: string | null;
  imageFilePath?: string | null;
  imageFilename?: string | null;
  isDefault?: unknown;
  default?: unknown;
  useForRandom?: string | boolean | null;
  defaultForAgents?: string | boolean | null;
  defaultParameters?: Record<string, unknown> | null;
  promptPresetId?: string | null;
  embeddingModel?: string | null;
  embeddingConnectionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const CONNECTION_SUMMARY_OPTIONS = {
  fields: [
    "id",
    "name",
    "provider",
    "model",
    "baseUrl",
    "maxContext",
    "capabilities",
    "providerMetadata",
    "capabilitiesStale",
    "folderId",
    "imagePath",
    "imageFilePath",
    "imageFilename",
    "isDefault",
    "default",
    "useForRandom",
    "defaultForAgents",
    "defaultParameters",
    "promptPresetId",
    "embeddingModel",
    "embeddingConnectionId",
    "createdAt",
    "updatedAt",
  ],
};

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function canAdvertiseLocalSidecar(status: LocalSidecarStatusResponse): boolean {
  const hasRuntime = status.runtime.installed || !!status.config.executablePath?.trim();
  return (
    status.configured &&
    status.enabled &&
    status.modelDownloaded &&
    hasRuntime &&
    status.status === "ready" &&
    status.ready &&
    !!status.baseUrl
  );
}

function localSidecarConnection(status: LocalSidecarStatusResponse): AvailableConnectionSummary {
  return {
    id: LOCAL_SIDECAR_CONNECTION_ID,
    name: "Local Model",
    provider: "custom",
    synthetic: true,
    model: status.config.model,
    baseUrl: status.baseUrl ?? "",
    maxContext: status.config.contextSize,
    useForRandom: false,
    isDefault: false,
    defaultForAgents: false,
    embeddingModel: status.config.model,
    createdAt: "",
    updatedAt: "",
  };
}

async function listAvailable(): Promise<AvailableConnectionSummary[]> {
  const [rows, sidecarStatus] = await Promise.all([
    storageApi.list<AvailableConnectionSummary>("connections", CONNECTION_SUMMARY_OPTIONS),
    localSidecarApi.status().catch(() => null),
  ]);
  if (!sidecarStatus || !canAdvertiseLocalSidecar(sidecarStatus)) return rows;
  return [localSidecarConnection(sidecarStatus), ...rows];
}

/** The fields default selection reads; stored rows may carry boolish flags. */
type DefaultTextConnectionCandidate = {
  id?: unknown;
  provider?: string | null;
  isDefault?: unknown;
  default?: unknown;
  [field: string]: unknown;
};

/** The chat fields recency reads; summaries and full chat rows both carry them. */
type RecentChatConnectionCandidate = {
  connectionId?: unknown;
  updatedAt?: unknown;
  characterIds?: unknown;
};

const RECENT_CHAT_CONNECTION_OPTIONS = { fields: ["connectionId", "updatedAt", "characterIds"] };

/**
 * Connection ids from set-up chats (at least one character), most recently updated first. Empty
 * drafts are skipped so a chat stranded on a broken connection cannot make it the default.
 */
function recentChatConnectionIds(chats: readonly RecentChatConnectionCandidate[]): string[] {
  const used = chats
    .filter((chat) => Array.isArray(chat.characterIds) && chat.characterIds.length > 0)
    .map((chat) => ({
      id: typeof chat.connectionId === "string" ? chat.connectionId.trim() : "",
      at: typeof chat.updatedAt === "string" ? Date.parse(chat.updatedAt) : Number.NaN,
    }))
    .filter((chat) => chat.id && Number.isFinite(chat.at))
    .sort((left, right) => right.at - left.at);
  return [...new Set(used.map((chat) => chat.id))];
}

/**
 * The connection new work should use: the one marked default, else the most recently used one
 * that still exists, else the first text connection.
 */
function selectDefaultTextConnectionId(
  connections: readonly DefaultTextConnectionCandidate[],
  recentConnectionIds: readonly string[] = [],
): string | null {
  const textConnections = filterLanguageGenerationConnections(connections);
  const recentlyUsed = recentConnectionIds
    .map((id) => textConnections.find((connection) => connection.id === id))
    .find((connection) => connection !== undefined);
  const selected =
    textConnections.find((connection) => boolish(connection.isDefault) || boolish(connection.default)) ??
    recentlyUsed ??
    textConnections[0];
  const connectionId = typeof selected?.id === "string" ? selected.id.trim() : "";
  return connectionId || null;
}

async function resolveDefaultTextConnectionId(): Promise<string> {
  const [connections, recentChats] = await Promise.all([
    listAvailable(),
    // Recency only refines the fallback; without it the first connection is still a valid answer.
    storageApi.list<RecentChatConnectionCandidate>("chats", RECENT_CHAT_CONNECTION_OPTIONS).catch((error: unknown) => {
      console.warn("[connections] Could not read recent chats; using the first text connection as fallback", error);
      return [];
    }),
  ]);
  const connectionId = selectDefaultTextConnectionId(connections, recentChatConnectionIds(recentChats));
  if (!connectionId) throw new Error("No text connection configured");
  return connectionId;
}

export const connectionCatalogApi = {
  listAvailable,
  recentChatConnectionIds,
  resolveDefaultTextConnectionId,
  selectDefaultTextConnectionId,
};
