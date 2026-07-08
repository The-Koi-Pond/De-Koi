// ──────────────────────────────────────────────
// React Query: Connection hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { connectionKeys } from "../query-keys";
import { chatKeys } from "../../chats/query-keys";

import {
  createConnectionSchema,
  type CreateConnectionInput,
  updateConnectionSchema,
} from "../../../../engine/contracts/schemas/connection.schema";
import { connectionCommandApi } from "../../../../shared/api/connection-command-api";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { storageCommandsApi } from "../../../../shared/api/storage-commands-api";
import {
  LOCAL_SIDECAR_CONNECTION_ID,
  type LocalSidecarStatusResponse,
} from "../../../../engine/contracts/types/sidecar";
import type { ConnectionRow, ConnectionTestResult } from "../types";

export { connectionKeys } from "../query-keys";

export type ClaudeSubscriptionDiagnosis = {
  success: boolean;
  requestedModel: string;
  modelsBilled: string[];
  modelUsageDetail: Array<{ model: string; inputTokens: number | null; outputTokens: number | null; role: string }>;
  fastModeState: string | null;
  downgraded: boolean;
  response: string;
  latencyMs: number;
};

type CreateConnectionVariables = Partial<CreateConnectionInput> & Pick<CreateConnectionInput, "name" | "provider">;
const CONNECTION_LIST_STALE_TIME_MS = 5_000;
const CONNECTION_LIST_REFETCH_INTERVAL_MS = 5_000;
const CONNECTION_REF_AGENT_QUERY_KEY = ["agents"] as const;

const CONNECTION_SUMMARY_OPTIONS = {
  fields: [
    "id",
    "name",
    "provider",
    "model",
    "baseUrl",
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

export type ConnectionSummary = Pick<
  ConnectionRow,
  "id" | "name" | "provider" | "model" | "baseUrl" | "useForRandom" | "createdAt" | "updatedAt" | "synthetic"
> & {
  folderId?: string | null;
  imagePath?: string | null;
  imageFilePath?: string | null;
  imageFilename?: string | null;
  isDefault?: string | boolean | null;
  default?: string | boolean | null;
  defaultForAgents?: string | boolean | null;
  defaultParameters?: Record<string, unknown> | null;
  promptPresetId?: string | null;
  embeddingModel?: string | null;
};

function isSyntheticConnectionId(id: string | null | undefined): boolean {
  return id === LOCAL_SIDECAR_CONNECTION_ID;
}

export function isSyntheticConnection(
  connection: (Pick<ConnectionSummary, "id"> & { synthetic?: boolean }) | null | undefined,
): boolean {
  return connection?.synthetic === true || isSyntheticConnectionId(connection?.id);
}

export function assertStoredConnectionId(id: string): string {
  if (isSyntheticConnectionId(id)) {
    throw new Error("Local Model is a runtime-only connection option and cannot be modified as a stored connection.");
  }
  return id;
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

export function useConnections(enabled = true) {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: async () => {
      const [rows, sidecarStatus] = await Promise.all([
        storageApi.list<ConnectionSummary>("connections", CONNECTION_SUMMARY_OPTIONS),
        localSidecarApi.status().catch(() => null),
      ]);
      if (!sidecarStatus || !canAdvertiseLocalSidecar(sidecarStatus)) return rows;
      return [
        {
          id: LOCAL_SIDECAR_CONNECTION_ID,
          name: "Local Model",
          provider: "custom",
          synthetic: true,
          model: sidecarStatus.config.model,
          baseUrl: sidecarStatus.baseUrl ?? "",
          useForRandom: false,
          isDefault: false,
          defaultForAgents: false,
          embeddingModel: sidecarStatus.config.model,
          createdAt: "",
          updatedAt: "",
        },
        ...rows,
      ];
    },
    enabled,
    staleTime: CONNECTION_LIST_STALE_TIME_MS,
    refetchInterval: CONNECTION_LIST_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useConnection(id: string | null) {
  return useQuery({
    queryKey: connectionKeys.detail(id ?? ""),
    queryFn: () => storageApi.get<Record<string, unknown>>("connections", assertStoredConnectionId(id!)),
    enabled: !!id && !isSyntheticConnectionId(id),
    staleTime: 5 * 60_000,
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateConnectionVariables) =>
      storageApi.create("connections", createConnectionSchema.parse(data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      storageApi.update("connections", assertStoredConnectionId(id), updateConnectionSchema.parse(data)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}

export function useDuplicateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      storageCommandsApi.duplicate<ConnectionRow>("connections", assertStoredConnectionId(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

type DeleteConnectionVariables = string | { id: string; force?: boolean };

type DeleteConnectionResult = { deleted: boolean; cleared?: { agents?: number; chats?: number } };

function deleteConnectionId(variables: DeleteConnectionVariables): string {
  return typeof variables === "string" ? variables : variables.id;
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variables: DeleteConnectionVariables) => {
      const id = assertStoredConnectionId(deleteConnectionId(variables));
      const force = typeof variables === "string" ? undefined : variables.force;
      return storageApi.delete("connections", id, { force }) as Promise<DeleteConnectionResult>;
    },
    onSuccess: (result, variables) => {
      const id = deleteConnectionId(variables);
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(id) });
      if (typeof variables !== "string" || result.cleared) {
        qc.invalidateQueries({ queryKey: chatKeys.all });
        qc.invalidateQueries({ queryKey: CONNECTION_REF_AGENT_QUERY_KEY });
      }
    },
    onSettled: (_result, _error, variables) => {
      if (typeof variables === "string" || !variables.force) return;
      const id = deleteConnectionId(variables);
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(id) });
      qc.invalidateQueries({ queryKey: chatKeys.all });
      qc.invalidateQueries({ queryKey: CONNECTION_REF_AGENT_QUERY_KEY });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: string) => connectionCommandApi.test<ConnectionTestResult>(id),
  });
}

export function useTestMessage() {
  return useMutation({
    mutationFn: (id: string) =>
      connectionCommandApi.testMessage<{ success: boolean; response: string; latencyMs: number }>(id),
  });
}

export function useTestImageGeneration() {
  return useMutation({
    mutationFn: (id: string) =>
      connectionCommandApi.testImage<{
        success: boolean;
        base64: string | null;
        mimeType: string | null;
        latencyMs: number;
        prompt: string;
        error?: string;
      }>(id),
  });
}

export function useDiagnoseClaudeSubscription() {
  return useMutation({
    mutationFn: (id: string) => connectionCommandApi.diagnoseClaudeSubscription<ClaudeSubscriptionDiagnosis>(id),
  });
}

export function useFetchModels() {
  return useMutation({
    mutationFn: (id: string) =>
      connectionCommandApi.models<{
        models: Array<{
          id: string;
          name: string;
          context?: number;
          maxOutput?: number;
          fallback?: boolean;
          fromProvider?: boolean;
          providerError?: string;
        }>;
        fromProvider: boolean;
        fallback?: boolean;
        providerError?: string;
        providerErrorCode?: string;
      }>(id),
  });
}

export function useSaveConnectionDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: Record<string, unknown> | null }) =>
      connectionCommandApi.saveDefaultParameters(assertStoredConnectionId(id), params),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}

export function useUploadConnectionImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, image, filename }: { id: string; image: string; filename?: string }) =>
      connectionCommandApi.uploadImage<ConnectionRow>(assertStoredConnectionId(id), image, filename),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}
