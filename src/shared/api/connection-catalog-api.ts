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

function selectDefaultTextConnectionId(connections: readonly AvailableConnectionSummary[]): string | null {
  const textConnections = filterLanguageGenerationConnections(connections);
  const selected =
    textConnections.find((connection) => boolish(connection.isDefault) || boolish(connection.default)) ??
    textConnections[0];
  const connectionId = typeof selected?.id === "string" ? selected.id.trim() : "";
  return connectionId || null;
}

async function resolveDefaultTextConnectionId(): Promise<string> {
  const connectionId = selectDefaultTextConnectionId(await listAvailable());
  if (!connectionId) throw new Error("No text connection configured");
  return connectionId;
}

export const connectionCatalogApi = {
  listAvailable,
  resolveDefaultTextConnectionId,
  selectDefaultTextConnectionId,
};
