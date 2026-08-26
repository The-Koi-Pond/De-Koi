// ──────────────────────────────────────────────
// React Query: Chat Preset hooks
// ──────────────────────────────────────────────
import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatPresetKeys } from "../query-keys";
import {
  chatPresetSettingsSchema,
  createChatPresetSchema,
} from "../../../../engine/contracts/schemas/chat-preset.schema";
import { chatModeSchema } from "../../../../engine/contracts/schemas/chat.schema";
import { boolish } from "../../../../engine/generation/runtime-records";
import { storageApi } from "../../../../shared/api/storage-api";
import { storageCommandsApi } from "../../../../shared/api/storage-commands-api";
import { chatPresetApi } from "../../../../shared/api/chat-preset-api";
import { chatKeys } from "../../chats/query-keys";
import type { StorageGateway } from "../../../../engine/capabilities/storage";
import type { Chat, ChatMode } from "../../../../engine/contracts/types/chat";
import {
  buildRoleplayWorkflowProfilePatch,
  buildRoleplayWorkflowProfileRevertPatch,
  resolveRoleplayWorkflowProfile,
  selectedLocalAssistAgentIds,
  type RoleplayWorkflowCapabilities,
  type RoleplayWorkflowProfileId,
  type RoleplayWorkflowProfileResolution,
} from "../../../../engine/modes/roleplay/workflow-profiles";
import {
  CHAT_PRESET_EXCLUDED_METADATA_KEYS,
  type ChatPreset,
  type ChatPresetSettings,
} from "../../../../engine/contracts/types/chat-preset";

const EXCLUDED_METADATA_KEYS = new Set<string>(CHAT_PRESET_EXCLUDED_METADATA_KEYS);
const CHAT_PRESET_METADATA_DEFAULTS: Record<string, unknown> = {
  agentOverrides: {},
  agentConnectionOverrides: {},
  agentRunIntervalOverrides: {},
  activeAgentIds: [],
  activeToolIds: [],
};

type RawChatPreset = ChatPreset & {
  default?: unknown;
  active?: unknown;
};

type ChatPresetExportPayload = {
  name: string;
  mode: ChatMode;
  settings: ChatPresetSettings;
};

type ChatPresetExportEnvelope = {
  type: "marinara_chat_preset";
  version: 1;
  exportedAt: string;
  data: ChatPresetExportPayload;
};

function parseSettings(value: unknown, mode?: ChatMode | null): ChatPresetSettings {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return sanitizeChatPresetSettings(JSON.parse(value), mode);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return sanitizeChatPresetSettings(value as ChatPresetSettings, mode);
  }
  return {};
}

function normalizeChatPresetFlags<T extends RawChatPreset>(preset: T): T & ChatPreset {
  const mode = chatModeSchema.safeParse(preset.mode).success ? (preset.mode as ChatMode) : null;
  return {
    ...preset,
    isDefault: boolish(preset.isDefault ?? preset.default, false),
    isActive: boolish(preset.isActive ?? preset.active, false),
    settings: parseSettings(preset.settings, mode),
  };
}

async function listChatPresets(mode?: ChatMode | null): Promise<ChatPreset[]> {
  const presets = (await storageApi.list<RawChatPreset>("chat-presets")).map(normalizeChatPresetFlags);
  return mode ? presets.filter((preset) => preset.mode === mode) : presets;
}

export function findUserStarredChatPreset(
  presets: readonly RawChatPreset[] | null | undefined,
  mode: ChatMode | null,
): ChatPreset | null {
  if (!mode) return null;
  return (
    presets
      ?.map(normalizeChatPresetFlags)
      .find((preset) => preset.mode === mode && preset.isActive && !preset.isDefault) ?? null
  );
}

function isPresetExcludedMetadataKey(key: string): boolean {
  return EXCLUDED_METADATA_KEYS.has(key) || key.startsWith("scene");
}

export function sanitizeChatPresetSettings(
  settings: ChatPresetSettings | null | undefined,
  mode?: ChatMode | null,
): ChatPresetSettings {
  const clean: ChatPresetSettings = {};
  if (!settings) return clean;

  if ("connectionId" in settings) clean.connectionId = settings.connectionId ?? null;
  if (mode !== "conversation" && "promptPresetId" in settings) clean.promptPresetId = settings.promptPresetId ?? null;

  if (settings.metadata && typeof settings.metadata === "object" && !Array.isArray(settings.metadata)) {
    const metadata = Object.fromEntries(
      Object.entries(settings.metadata).filter(([key]) => !isPresetExcludedMetadataKey(key)),
    );
    if (Object.keys(metadata).length > 0) clean.metadata = metadata;
  }

  return chatPresetSettingsSchema.parse(clean);
}

export function createChatPresetExportEnvelope(preset: ChatPreset): ChatPresetExportEnvelope {
  return {
    type: "marinara_chat_preset",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      name: preset.name,
      mode: preset.mode,
      settings: sanitizeChatPresetSettings(preset.settings, preset.mode),
    },
  };
}

export function parseChatPresetImportEnvelope(envelope: unknown): Record<string, unknown> {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Invalid chat preset envelope");
  }
  const record = envelope as Record<string, unknown>;
  if (record.type !== "marinara_chat_preset" || !record.data || typeof record.data !== "object") {
    throw new Error("Invalid chat preset envelope");
  }
  const data = record.data as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim().slice(0, 120) : "";
  if (!name) throw new Error("Preset name is required");
  const mode = chatModeSchema.parse(data.mode);
  return createChatPresetSchema.parse({
    name,
    mode,
    settings: sanitizeChatPresetSettings(parseSettings(data.settings, mode), mode),
  });
}

export function useChatPresets(mode?: ChatMode | null, enabled = true) {
  return useQuery({
    queryKey: chatPresetKeys.list(mode ?? null),
    queryFn: () => listChatPresets(mode),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; settings?: ChatPresetSettings }) =>
      storageApi.update<ChatPreset>("chat-presets", id, {
        ...data,
        ...(data.settings ? { settings: sanitizeChatPresetSettings(data.settings) } : {}),
      } as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useCreateChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; mode: ChatMode; settings: ChatPresetSettings }) =>
      storageApi.create<ChatPreset>(
        "chat-presets",
        createChatPresetSchema.parse({
          name: data.name,
          mode: data.mode,
          settings: sanitizeChatPresetSettings(data.settings, data.mode),
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useSaveChatPresetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: ChatPresetSettings }) =>
      storageApi.update<ChatPreset>("chat-presets", id, {
        settings: sanitizeChatPresetSettings(settings) as unknown as Record<string, unknown>,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useDuplicateChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const duplicated = await storageCommandsApi.duplicate<ChatPreset>("chat-presets", id);
      return name?.trim()
        ? storageApi.update<ChatPreset>("chat-presets", duplicated.id, { name: name.trim() })
        : duplicated;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useSetActiveChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chatPresetApi.setActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useDeleteChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("chat-presets", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function useImportChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envelope: unknown) =>
      storageApi.create<ChatPreset>("chat-presets", parseChatPresetImportEnvelope(envelope)),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatPresetKeys.all }),
  });
}

export function buildChatPresetApplicationPatch(
  preset: ChatPreset,
  chat: Pick<Chat, "mode" | "connectionId" | "promptPresetId" | "metadata">,
): Record<string, unknown> {
  const settings = sanitizeChatPresetSettings(preset.settings, preset.mode);
  const currentMetadata =
    chat.metadata && typeof chat.metadata === "object" && !Array.isArray(chat.metadata) ? chat.metadata : {};
  const preservedMetadata = Object.fromEntries(
    Object.entries(currentMetadata).filter(([key]) => isPresetExcludedMetadataKey(key)),
  );
  const nextMetadata: Record<string, unknown> = {
    ...CHAT_PRESET_METADATA_DEFAULTS,
    ...(settings.metadata ?? {}),
    ...preservedMetadata,
    appliedChatPresetId: preset.id,
  };
  if (!Object.prototype.hasOwnProperty.call(nextMetadata, "enableAgents")) {
    nextMetadata.enableAgents = Array.isArray(nextMetadata.activeAgentIds) && nextMetadata.activeAgentIds.length > 0;
  }
  return {
    metadata: nextMetadata,
    connectionId: "connectionId" in settings ? (settings.connectionId ?? null) : null,
    promptPresetId:
      chat.mode === "conversation" ? null : "promptPresetId" in settings ? (settings.promptPresetId ?? null) : null,
  };
}

/** Apply a preset's settings to an existing chat. Refetches the chat afterward. */
export function useApplyChatPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ presetId, chatId }: { presetId: string; chatId: string }) => {
      const [preset, chat] = await Promise.all([
        storageApi.get<ChatPreset>("chat-presets", presetId),
        storageApi.get<Chat>("chats", chatId),
      ]);
      if (!preset) throw new Error(`Chat preset ${presetId} was not found`);
      if (!chat) throw new Error(`Chat ${chatId} was not found`);

      return storageApi.update<Chat>("chats", chatId, buildChatPresetApplicationPatch(preset, chat));
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

export function useApplyUserStarredChatPreset() {
  const queryClient = useQueryClient();
  const { mutateAsync: applyChatPreset } = useApplyChatPreset();

  return useCallback(
    async ({ mode, chatId }: { mode: ChatMode; chatId: string }): Promise<ChatPreset | null> => {
      const presets = await queryClient.fetchQuery({
        queryKey: chatPresetKeys.list(null),
        queryFn: () => listChatPresets(null),
        staleTime: 60_000,
      });
      const starred = findUserStarredChatPreset(presets, mode);
      if (!starred) return null;

      await applyChatPreset({ presetId: starred.id, chatId });
      return starred;
    },
    [applyChatPreset, queryClient],
  );
}

type RoleplayWorkflowProfileStorage = Pick<StorageGateway, "get" | "update">;

export interface ApplyRoleplayWorkflowProfileInput {
  chatId: string;
  profileId: RoleplayWorkflowProfileId;
  preview: RoleplayWorkflowProfileResolution;
  selectedItemIds: readonly string[];
  /** Loaded at mutation time so prerequisites cannot be stale from the preview UI. */
  resolveCapabilities: (chat: Chat) => Promise<RoleplayWorkflowCapabilities>;
  /** Rechecks each Local Assist assignment immediately before the single durable write. */
  isLocalSidecarAssignmentReady?: (agentId: string, chat: Chat) => Promise<boolean>;
  storage?: RoleplayWorkflowProfileStorage;
  now?: () => string;
}

export type ApplyRoleplayWorkflowProfileResult =
  | {
      outcome: "stale";
      resolution: RoleplayWorkflowProfileResolution;
      selectedItemIds: readonly string[];
      omittedLocalAgentIds: readonly string[];
      skippedLocalRoutingAgentIds: readonly string[];
    }
  | {
      outcome: "applied";
      chat: Chat;
      resolution: RoleplayWorkflowProfileResolution;
      selectedItemIds: readonly string[];
      omittedLocalAgentIds: readonly string[];
      skippedLocalRoutingAgentIds: readonly string[];
    };

export interface RevertRoleplayWorkflowProfileInput {
  chatId: string;
  storage?: RoleplayWorkflowProfileStorage;
}

export type RevertRoleplayWorkflowProfileResult =
  | { outcome: "not_applied"; chat: Chat; skippedConflicts: readonly string[] }
  | { outcome: "reverted"; chat: Chat; skippedConflicts: readonly string[] };

function sameWorkflowResolution(
  left: RoleplayWorkflowProfileResolution,
  right: RoleplayWorkflowProfileResolution,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function roleplayWorkflowPatchForChat(
  chat: Chat,
  patch: ReturnType<typeof buildRoleplayWorkflowProfilePatch>,
): Record<string, unknown> {
  const { metadata, ...topLevel } = patch;
  return {
    ...topLevel,
    metadata: { ...chat.metadata, ...metadata },
  };
}

/**
 * Applies a caller-confirmed workflow preview only if the freshly resolved preview still matches.
 * Its only durable mutation is one complete chat patch, so embedded and remote storage share the path.
 */
export async function applyRoleplayWorkflowProfile(
  input: ApplyRoleplayWorkflowProfileInput,
): Promise<ApplyRoleplayWorkflowProfileResult> {
  const storage = input.storage ?? storageApi;
  const chat = await storage.get<Chat>("chats", input.chatId);
  if (!chat) throw new Error(`Chat ${input.chatId} was not found`);
  const capabilities = await input.resolveCapabilities(chat);

  const resolution = resolveRoleplayWorkflowProfile(input.profileId, { chat, capabilities });
  const selectedItemIds = [...new Set(input.selectedItemIds)];
  if (!sameWorkflowResolution(input.preview, resolution)) {
    return {
      outcome: "stale",
      resolution,
      selectedItemIds,
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
    };
  }

  const selected = new Set(selectedItemIds);
  const omittedLocalAgentIds: string[] = [];
  const skippedLocalRoutingAgentIds: string[] = [];
  const localAssistAgentIds = selectedLocalAssistAgentIds(resolution, selected);
  if (input.profileId === "local-assist" && localAssistAgentIds.length > 0 && !input.isLocalSidecarAssignmentReady) {
    throw new Error("Local Assist requires a per-assignment local sidecar readiness resolver.");
  }
  for (const agentId of localAssistAgentIds) {
    const ready = capabilities.localSidecarReady && (await input.isLocalSidecarAssignmentReady!(agentId, chat));
    if (ready) continue;
    selected.delete(`agent:${agentId}`);
    selected.delete(`connection:${agentId}`);
    if (resolution.baseline.metadata.activeAgentIds?.includes(agentId)) {
      skippedLocalRoutingAgentIds.push(agentId);
    } else {
      omittedLocalAgentIds.push(agentId);
    }
  }

  const acceptedItemIds = selectedItemIds.filter((itemId) => selected.has(itemId));
  const patch = buildRoleplayWorkflowProfilePatch(
    resolution,
    acceptedItemIds,
    (input.now ?? (() => new Date().toISOString()))(),
  );
  const updated = await storage.update<Chat>("chats", input.chatId, roleplayWorkflowPatchForChat(chat, patch));
  return {
    outcome: "applied",
    chat: updated,
    resolution,
    selectedItemIds: acceptedItemIds,
    omittedLocalAgentIds,
    skippedLocalRoutingAgentIds,
  };
}

/** Reverts the latest workflow receipt without overwriting fields subsequently changed by the user. */
export async function revertRoleplayWorkflowProfile(
  input: RevertRoleplayWorkflowProfileInput,
): Promise<RevertRoleplayWorkflowProfileResult> {
  const storage = input.storage ?? storageApi;
  const chat = await storage.get<Chat>("chats", input.chatId);
  if (!chat) throw new Error(`Chat ${input.chatId} was not found`);
  const receipt = chat.metadata.roleplayWorkflowApplication;
  if (!receipt) return { outcome: "not_applied", chat, skippedConflicts: [] };

  const { patch, skippedConflicts } = buildRoleplayWorkflowProfileRevertPatch(chat, receipt);
  const updated = await storage.update<Chat>("chats", input.chatId, roleplayWorkflowPatchForChat(chat, patch));
  return { outcome: "reverted", chat: updated, skippedConflicts };
}

export function useApplyRoleplayWorkflowProfile(
  options: Omit<ApplyRoleplayWorkflowProfileInput, "storage" | "chatId" | "profileId" | "preview" | "selectedItemIds">,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Pick<ApplyRoleplayWorkflowProfileInput, "chatId" | "profileId" | "preview" | "selectedItemIds">,
    ) => applyRoleplayWorkflowProfile({ ...options, ...input, storage: storageApi }),
    onSuccess: (result, variables) => {
      if (result.outcome !== "applied") return;
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

export function useRevertRoleplayWorkflowProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => revertRoleplayWorkflowProfile({ chatId, storage: storageApi }),
    onSuccess: (_result, chatId) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}
