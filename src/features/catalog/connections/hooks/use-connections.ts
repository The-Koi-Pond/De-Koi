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
import {
  connectionCatalogApi,
  type AvailableConnectionSummary,
} from "../../../../shared/api/connection-catalog-api";
import { connectionCommandApi } from "../../../../shared/api/connection-command-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { storageCommandsApi } from "../../../../shared/api/storage-commands-api";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../../../engine/contracts/types/sidecar";
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
const CONNECTION_LIST_STALE_TIME_MS = 60_000;
const CONNECTION_LIST_REFETCH_INTERVAL_MS = 60_000;
const CONNECTION_REF_AGENT_QUERY_KEY = ["agents"] as const;

export type ConnectionSummary = AvailableConnectionSummary;

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

export function useConnections(enabled = true) {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: connectionCatalogApi.listAvailable,
    enabled,
    staleTime: CONNECTION_LIST_STALE_TIME_MS,
    refetchInterval: CONNECTION_LIST_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
