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
import {
  roleplayContinuityDirectorApi,
  roleplayContinuityDirectorKeys,
  type RoleplayContinuityDirectorApi,
} from "../../../../shared/api/roleplay-continuity-director-api";
import { chatKeys } from "../../chats/query-keys";
import type { StorageGateway } from "../../../../engine/capabilities/storage";
import type {
  Chat,
  ChatMode,
  RoleplayWorkflowApplicationReceipt,
} from "../../../../engine/contracts/types/chat";
import type { RoleplayContinuityDirectorState } from "../../../../engine/contracts/types/roleplay-continuity-director";
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

type RoleplayWorkflowProfileStorage = Pick<StorageGateway, "get" | "updateChatIfUnchanged">;

function conditionalChatUpdate(
  storage: RoleplayWorkflowProfileStorage,
  chatId: string,
  expected: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<{ updated: boolean; chat: Chat }> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged) {
    throw new Error("Conditional chat persistence is unavailable.");
  }
  return updateChatIfUnchanged.call(storage, chatId, expected, patch) as Promise<{ updated: boolean; chat: Chat }>;
}

function expectedValuesForWorkflowPatch(chat: Chat, patch: Record<string, unknown>): Record<string, unknown> {
  const expected: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (key !== "metadata") {
      expected[key] = (chat as unknown as Record<string, unknown>)[key] ?? null;
      continue;
    }
    const metadataPatch = patch.metadata as Record<string, unknown>;
    const expectedMetadata: Record<string, unknown> = {};
    for (const metadataKey of Object.keys(metadataPatch)) {
      expectedMetadata[metadataKey] = (chat.metadata as unknown as Record<string, unknown>)[metadataKey] ?? null;
    }
    if ("activeAgentIds" in metadataPatch && !("enableAgents" in metadataPatch)) {
      expectedMetadata.enableAgents = chat.metadata.enableAgents ?? null;
    }
    expected.metadata = expectedMetadata;
  }
  return expected;
}

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
      shouldCreateContinuityPlan: false;
    }
  | {
      outcome: "applied";
      chat: Chat;
      resolution: RoleplayWorkflowProfileResolution;
      selectedItemIds: readonly string[];
      omittedLocalAgentIds: readonly string[];
      skippedLocalRoutingAgentIds: readonly string[];
      shouldCreateContinuityPlan: boolean;
    };

export interface RevertRoleplayWorkflowProfileInput {
  chatId: string;
  storage?: RoleplayWorkflowProfileStorage;
}

export type RevertRoleplayWorkflowProfileResult =
  | { outcome: "not_applied"; chat: Chat; skippedConflicts: readonly string[] }
  | { outcome: "stale"; chat: Chat; skippedConflicts: readonly string[] }
  | { outcome: "reverted"; chat: Chat; skippedConflicts: readonly string[] };

function sameWorkflowReceipt(
  left: RoleplayWorkflowApplicationReceipt,
  right: RoleplayWorkflowApplicationReceipt,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameWorkflowResolution(
  left: RoleplayWorkflowProfileResolution,
  right: RoleplayWorkflowProfileResolution,
): boolean {
  const comparable = (resolution: RoleplayWorkflowProfileResolution) => {
    const { connectionId: _connectionId, hasSourceSnapshot: _hasSourceSnapshot, ...directorConfiguration } =
      resolution.baseline.continuityDirector;
    return {
      ...resolution,
      baseline: {
        ...resolution.baseline,
        continuityDirector: directorConfiguration,
      },
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/**
 * Applies a caller-confirmed workflow preview only if the freshly resolved preview still matches.
 * Its only durable mutation is one conditional chat patch, so embedded and remote storage share the path.
 */
export async function applyRoleplayWorkflowProfile(
  input: ApplyRoleplayWorkflowProfileInput,
): Promise<ApplyRoleplayWorkflowProfileResult> {
  const storage = input.storage ?? storageApi;
  const chat = await storage.get<Chat>("chats", input.chatId);
  if (!chat) throw new Error(`Chat ${input.chatId} was not found`);
  if (chat.mode !== "roleplay") {
    throw new Error("Roleplay workflow profiles can only be applied to Roleplay chats.");
  }
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
      shouldCreateContinuityPlan: false,
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
  const latestChat = await storage.get<Chat>("chats", input.chatId);
  if (!latestChat) throw new Error(`Chat ${input.chatId} was not found`);
  if (latestChat.mode !== "roleplay") {
    throw new Error("Roleplay workflow profiles can only be applied to Roleplay chats.");
  }
  const latestResolution = resolveRoleplayWorkflowProfile(input.profileId, { chat: latestChat, capabilities });
  if (!sameWorkflowResolution(input.preview, latestResolution)) {
    return {
      outcome: "stale",
      resolution: latestResolution,
      selectedItemIds,
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: false,
    };
  }

  const shouldCreateContinuityPlan =
    selected.has("continuity-director") &&
    !latestResolution.baseline.continuityDirector.enabled &&
    !latestResolution.baseline.continuityDirector.hasPlan;
  const patch = buildRoleplayWorkflowProfilePatch(
    latestResolution,
    acceptedItemIds,
    (input.now ?? (() => new Date().toISOString()))(),
    latestChat.metadata.roleplayContinuityDirector,
  );
  const workflowPatch = patch as unknown as Record<string, unknown>;
  const conditional = await conditionalChatUpdate(
    storage,
    input.chatId,
    expectedValuesForWorkflowPatch(latestChat, workflowPatch),
    workflowPatch,
  );
  if (!conditional.updated) {
    const winningChat = conditional.chat;
    const winningResolution = resolveRoleplayWorkflowProfile(input.profileId, {
      chat: winningChat,
      capabilities,
    });
    return {
      outcome: "stale",
      resolution: winningResolution,
      selectedItemIds,
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: false,
    };
  }
  return {
    outcome: "applied",
    chat: conditional.chat,
    resolution: latestResolution,
    selectedItemIds: acceptedItemIds,
    omittedLocalAgentIds,
    skippedLocalRoutingAgentIds,
    shouldCreateContinuityPlan,
  };
}

/** Reverts the latest workflow receipt without overwriting fields subsequently changed by the user. */
export async function revertRoleplayWorkflowProfile(
  input: RevertRoleplayWorkflowProfileInput,
): Promise<RevertRoleplayWorkflowProfileResult> {
  const storage = input.storage ?? storageApi;
  let chat = await storage.get<Chat>("chats", input.chatId);
  if (!chat) throw new Error(`Chat ${input.chatId} was not found`);
  const requestedReceipt = chat.metadata.roleplayWorkflowApplication;
  if (!requestedReceipt) return { outcome: "not_applied", chat, skippedConflicts: [] };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentChat: Chat = chat;
    const receipt = currentChat.metadata.roleplayWorkflowApplication;
    if (!receipt) return { outcome: "not_applied", chat: currentChat, skippedConflicts: [] };
    if (!sameWorkflowReceipt(receipt, requestedReceipt)) {
      return { outcome: "stale", chat: currentChat, skippedConflicts: [] };
    }
    const { patch, skippedConflicts } = buildRoleplayWorkflowProfileRevertPatch(currentChat, receipt);
    const workflowPatch = patch as unknown as Record<string, unknown>;
    const conditional: { updated: boolean; chat: Chat } = await conditionalChatUpdate(
      storage,
      input.chatId,
      expectedValuesForWorkflowPatch(currentChat, workflowPatch),
      workflowPatch,
    );
    if (conditional.updated) {
      return { outcome: "reverted", chat: conditional.chat, skippedConflicts };
    }
    chat = conditional.chat;
  }

  throw new Error("Roleplay workflow changed repeatedly while reverting. Try again.");
}

export function useApplyRoleplayWorkflowProfile(
  options: Omit<ApplyRoleplayWorkflowProfileInput, "storage" | "chatId" | "profileId" | "preview" | "selectedItemIds">,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Pick<ApplyRoleplayWorkflowProfileInput, "chatId" | "profileId" | "preview" | "selectedItemIds">,
    ) => applyRoleplayWorkflowProfile({ ...options, ...input, storage: storageApi }),
    onSettled: (_result, _error, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: roleplayContinuityDirectorKeys.state(variables.chatId) });
    },
  });
}

export function useCreateInitialContinuityPlan(
  api: Pick<RoleplayContinuityDirectorApi, "refresh"> = roleplayContinuityDirectorApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      expectedDirectorState,
    }: {
      chatId: string;
      expectedDirectorState: RoleplayContinuityDirectorState;
    }) => api.refresh(chatId, { initialExpectedDirectorState: expectedDirectorState }),
    onSettled: (_data, _error, { chatId }) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: roleplayContinuityDirectorKeys.state(chatId) });
    },
  });
}

export function useRevertRoleplayWorkflowProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => revertRoleplayWorkflowProfile({ chatId, storage: storageApi }),
    onSettled: (_result, _error, chatId) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: roleplayContinuityDirectorKeys.state(chatId) });
    },
  });
}
