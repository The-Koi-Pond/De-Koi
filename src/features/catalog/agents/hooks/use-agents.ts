// ──────────────────────────────────────────────
// Hooks: Agent Configs (React Query)
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createAgentConfigSchema, updateAgentConfigSchema } from "../../../../engine/contracts/schemas/agent.schema";
import { BUILT_IN_AGENTS, type AgentResultType } from "../../../../engine/contracts/types/agent";
import { agentApi } from "../../../../shared/api/agent-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useEnabledToggleMutation } from "../../lib/use-enabled-toggle-mutation";

export const agentKeys = {
  all: ["agents"] as const,
  customRuns: (chatId: string) => ["agents", "runs", "custom", chatId] as const,
};

export interface AgentConfigRow {
  id: string;
  type: string;
  name: string;
  description: string;
  credit?: string;
  imagePath?: string | null;
  imageFilePath?: string | null;
  imageFilename?: string | null;
  imageUpdatedAt?: string | null;
  phase: string;
  enabled?: boolean | number | string | null;
  connectionId: string | null;
  promptTemplate: string;
  settings: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunRow {
  id: string;
  agentConfigId: string;
  agentType: string;
  agentName: string;
  chatId: string;
  messageId: string;
  resultType: string;
  resultData: unknown;
  tokensUsed: number;
  durationMs: number;
  success: boolean;
  error: string | null;
  createdAt: string;
}

export const LEGACY_BUILT_IN_AGENT_TYPES = new Set(["spotify"]);
const builtInAgentTypes = new Set([...BUILT_IN_AGENTS.map((agent) => agent.id), ...LEGACY_BUILT_IN_AGENT_TYPES]);
const agentResultTypeValues = [
  "game_state_update",
  "text_rewrite",
  "sprite_change",
  "echo_message",
  "quest_update",
  "image_prompt",
  "context_injection",
  "continuity_check",
  "director_event",
  "lorebook_update",
  "character_card_update",
  "prompt_review",
  "background_change",
  "character_tracker_update",
  "persona_stats_update",
  "custom_tracker_update",
  "chat_summary",
  "music_control",
  "spotify_control",
  "cyoa_choices",
  "secret_plot",
  "game_master_narration",
  "party_action",
  "game_map_update",
  "game_state_transition",
] satisfies AgentResultType[];
const agentResultTypes = new Set<string>(agentResultTypeValues);

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseStoredResultData(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function builtinAgentTypeFromConfigId(agentConfigId: string): string {
  return agentConfigId.startsWith("builtin:") ? agentConfigId.slice("builtin:".length).trim() : "";
}

function rawTypeLooksLikeAgentType(rawType: string, resultType: string): boolean {
  return !!rawType && rawType !== resultType && !agentResultTypes.has(rawType);
}

function normalizeAgentRunRow(
  raw: Record<string, unknown>,
  configsById: Map<string, AgentConfigRow>,
): AgentRunRow | null {
  const id = readString(raw.id);
  const agentConfigId = readString(raw.agentConfigId) || readString(raw.agent_config_id);
  const config = agentConfigId ? configsById.get(agentConfigId) : undefined;
  const resultType = readString(raw.resultType) || readString(raw.result_type);
  const rawType = readString(raw.type);
  const agentType =
    readString(raw.agentType) ||
    readString(raw.agent_type) ||
    readString(config?.type) ||
    builtinAgentTypeFromConfigId(agentConfigId) ||
    (rawTypeLooksLikeAgentType(rawType, resultType) ? rawType : "");
  const chatId = readString(raw.chatId) || readString(raw.chat_id);
  const messageId = readString(raw.messageId) || readString(raw.message_id);
  if (!id || !agentType || !chatId) return null;

  return {
    id,
    agentConfigId,
    agentType,
    agentName: readString(raw.agentName) || readString(config?.name) || agentType,
    chatId,
    messageId,
    resultType: resultType || agentType,
    resultData: parseStoredResultData(raw.resultData ?? raw.result_data),
    tokensUsed: readNumber(raw.tokensUsed ?? raw.tokens_used),
    durationMs: readNumber(raw.durationMs ?? raw.duration_ms),
    success: readBoolean(raw.success),
    error: readString(raw.error) || null,
    createdAt: readString(raw.createdAt) || readString(raw.created_at),
  };
}

export function agentCreditLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function agentEnabledFlag(value: unknown, fallback = true): boolean {
  return readBoolean(value, fallback);
}

export function isBuiltInOrLegacyAgentType(type: string | null | undefined): boolean {
  const normalized = readString(type);
  return !!normalized && builtInAgentTypes.has(normalized);
}

export function isCustomAgentConfig(config: Pick<AgentConfigRow, "type">): boolean {
  return !isBuiltInOrLegacyAgentType(config.type);
}

function normalizeAgentUpdatePayload(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data.data;
  const patch =
    Object.keys(data).length === 1 && nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : data;
  return updateAgentConfigSchema.parse(patch);
}

export function useAgentConfigs(enabled = true) {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: () => storageApi.list<AgentConfigRow>("agents"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCustomAgentRuns(chatId: string | null, enabled = true) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: agentKeys.customRuns(chatId ?? ""),
    queryFn: async () => {
      const cachedConfigs = queryClient.getQueryData<AgentConfigRow[]>(agentKeys.all);
      const [runs, configs] = await Promise.all([
        agentApi.listRunsForChat<Record<string, unknown>>(chatId as string),
        cachedConfigs ? Promise.resolve(cachedConfigs) : storageApi.list<AgentConfigRow>("agents"),
      ]);
      const configsById = new Map(configs.map((config) => [config.id, config]));
      return runs
        .map((run) => normalizeAgentRunRow(run, configsById))
        .filter((run): run is AgentRunRow => !!run && !isBuiltInOrLegacyAgentType(run.agentType));
    },
    enabled: !!chatId && enabled,
    staleTime: 15_000,
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      storageApi.update("agents", id, normalizeAgentUpdatePayload(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgentByType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentType, ...data }: { agentType: string } & Record<string, unknown>) =>
      agentApi.patchByType(agentType, updateAgentConfigSchema.parse(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUploadAgentImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      agentType,
      image,
      filename,
    }: {
      id?: string;
      agentType?: string;
      image: string;
      filename?: string;
    }) => {
      if (id) return agentApi.uploadImage<AgentConfigRow>(id, image, filename);
      if (agentType) return agentApi.uploadImageByType<AgentConfigRow>(agentType, image, filename);
      throw new Error("Agent id or type is required");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useSetAgentEnabledByType() {
  return useEnabledToggleMutation({
    mutationKey: [...agentKeys.all, "enabled"],
    queryKey: agentKeys.all,
    update: (agentType, enabled) => agentApi.patchByType(agentType, { enabled }),
    errorMessage: "Couldn't update that agent. Its previous state was restored.",
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => storageApi.create("agents", createAgentConfigSchema.parse(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgentRunData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resultData }: { id: string; chatId: string; resultData: unknown }) =>
      storageApi.update("agent-runs", id, { resultData }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: agentKeys.customRuns(variables.chatId) });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("agents", id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}
