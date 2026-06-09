// ──────────────────────────────────────────────
// React Query: Connection hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { connectionKeys } from "../query-keys";
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

const CONNECTION_SUMMARY_OPTIONS = {
  fields: [
    "id",
    "name",
    "provider",
    "model",
    "baseUrl",
    "folderId",
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
  "id" | "name" | "provider" | "model" | "baseUrl" | "useForRandom" | "createdAt" | "updatedAt"
> & {
  folderId?: string | null;
  isDefault?: string | boolean | null;
  default?: string | boolean | null;
  defaultForAgents?: string | boolean | null;
  defaultParameters?: Record<string, unknown> | null;
  promptPresetId?: string | null;
  embeddingModel?: string | null;
};

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
    queryFn: () => storageApi.get<Record<string, unknown>>("connections", id!),
    enabled: !!id,
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
      storageApi.update("connections", id, updateConnectionSchema.parse(data)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}

export function useDuplicateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageCommandsApi.duplicate<ConnectionRow>("connections", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("connections", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
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
      connectionCommandApi.saveDefaultParameters(id, params),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}
