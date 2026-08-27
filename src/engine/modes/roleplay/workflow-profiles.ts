import { BUILT_IN_AGENT_IDS } from "../../contracts/types/agent";
import type {
  ChatMode,
  ChatMetadata,
  RoleplayWorkflowApplicationChange,
  RoleplayWorkflowApplicationReceipt,
} from "../../contracts/types/chat";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../contracts/types/sidecar";
import { DE_KOI_UNIVERSAL_PRESET_ID } from "./scene/universal-preset";

export type RoleplayWorkflowProfileId = "minimal-clean" | "longform-continuity" | "cinematic" | "local-assist";

export interface RoleplayWorkflowProfileRecipeV1 {
  version: 1;
  agentIds: readonly string[];
  optionalAgentIds?: readonly string[];
  connectionOverrides?: Readonly<Record<string, string>>;
  runIntervalOverrides?: Readonly<Record<string, number>>;
}

export const ROLEPLAY_WORKFLOW_PROFILE_RECIPES_V1: Readonly<
  Record<RoleplayWorkflowProfileId, RoleplayWorkflowProfileRecipeV1>
> = {
  "minimal-clean": { version: 1, agentIds: [] },
  "longform-continuity": {
    version: 1,
    agentIds: [BUILT_IN_AGENT_IDS.CONTINUITY, BUILT_IN_AGENT_IDS.WORLD_STATE, BUILT_IN_AGENT_IDS.CHAT_SUMMARY],
    runIntervalOverrides: { [BUILT_IN_AGENT_IDS.CHAT_SUMMARY]: 5 },
  },
  cinematic: {
    version: 1,
    agentIds: [BUILT_IN_AGENT_IDS.EXPRESSION, BUILT_IN_AGENT_IDS.BACKGROUND],
    optionalAgentIds: [BUILT_IN_AGENT_IDS.ILLUSTRATOR, BUILT_IN_AGENT_IDS.MUSIC_DJ],
  },
  "local-assist": {
    version: 1,
    agentIds: [BUILT_IN_AGENT_IDS.WORLD_STATE, BUILT_IN_AGENT_IDS.EXPRESSION, BUILT_IN_AGENT_IDS.CHARACTER_TRACKER],
    connectionOverrides: {
      [BUILT_IN_AGENT_IDS.WORLD_STATE]: LOCAL_SIDECAR_CONNECTION_ID,
      [BUILT_IN_AGENT_IDS.EXPRESSION]: LOCAL_SIDECAR_CONNECTION_ID,
      [BUILT_IN_AGENT_IDS.CHARACTER_TRACKER]: LOCAL_SIDECAR_CONNECTION_ID,
    },
  },
};

export interface RoleplayWorkflowCapabilities {
  hasUniversalPreset: boolean;
  localSidecarReady: boolean;
  hasImageConnection: boolean;
  imageConnection?: {
    label: string;
    mayUsePaidOrExternalService: boolean;
  } | null;
  hasUsableBackgroundAssets: boolean;
  musicModuleEnabled: boolean;
  ttsReady: boolean;
}

export interface RoleplayWorkflowProfileInput {
  chat: {
    mode: ChatMode;
    promptPresetId: string | null;
    connectionId?: string | null;
    metadata: Partial<ChatMetadata>;
  };
  capabilities: RoleplayWorkflowCapabilities;
}

export interface RoleplayWorkflowChangeRow {
  id: string;
  kind: "change" | "information";
  before: unknown;
  after: unknown;
  selectedByDefault: boolean;
  selectable: boolean;
  expectedExtraCalls: number;
  destination: string | null;
  prerequisites: readonly string[];
  warnings: readonly string[];
}

export interface RoleplayWorkflowProfileResolution {
  profileId: RoleplayWorkflowProfileId;
  version: 1;
  rows: readonly RoleplayWorkflowChangeRow[];
  baseline: {
    promptPresetId: string | null;
    metadata: Pick<
      ChatMetadata,
      | "enableMemoryRecall"
      | "enableAgents"
      | "activeAgentIds"
      | "agentConnectionOverrides"
      | "agentRunIntervalOverrides"
    >;
  };
}

export interface RoleplayWorkflowProfilePatch {
  promptPresetId?: string | null;
  metadata: Partial<ChatMetadata>;
}

export interface RoleplayWorkflowProfileRevertResult {
  patch: RoleplayWorkflowProfilePatch;
  skippedConflicts: string[];
}

export function resolveRoleplayWorkflowProfile(
  profileId: RoleplayWorkflowProfileId,
  input: RoleplayWorkflowProfileInput,
): RoleplayWorkflowProfileResolution {
  if (input.chat.mode !== "roleplay") {
    throw new Error("Roleplay workflow profiles can only be resolved for Roleplay chats.");
  }
  const recipe = ROLEPLAY_WORKFLOW_PROFILE_RECIPES_V1[profileId];
  const metadata = input.chat.metadata;
  const activeAgentIds = metadata.activeAgentIds ?? [];
  const agentConnectionOverrides = metadata.agentConnectionOverrides ?? {};
  const agentRunIntervalOverrides = metadata.agentRunIntervalOverrides ?? {};
  const rows: RoleplayWorkflowChangeRow[] = [
    {
      id: "prompt-preset",
      kind: "change",
      before: input.chat.promptPresetId,
      after: DE_KOI_UNIVERSAL_PRESET_ID,
      selectedByDefault: !input.chat.promptPresetId,
      selectable: input.capabilities.hasUniversalPreset,
      expectedExtraCalls: 0,
      destination: "Roleplay writer prompt",
      prerequisites: input.capabilities.hasUniversalPreset ? [] : ["Universal V2 preset is not installed."],
      warnings: [],
    },
    {
      id: "memory-recall",
      kind: "change",
      before: metadata.enableMemoryRecall,
      after: true,
      selectedByDefault: metadata.enableMemoryRecall === undefined,
      selectable: true,
      expectedExtraCalls: 0,
      destination: "Roleplay prompt context",
      prerequisites: [],
      warnings: [],
    },
  ];

  if (profileId === "minimal-clean") {
    rows.push({
      id: "disable-automatic-agents",
      kind: "change",
      before: { enableAgents: metadata.enableAgents, activeAgentIds },
      after: { enableAgents: false, activeAgentIds: [] },
      selectedByDefault: activeAgentIds.length === 0 && metadata.enableAgents === undefined,
      selectable: true,
      expectedExtraCalls: 0,
      destination: "Automatic roleplay agents",
      prerequisites: [],
      warnings: [],
    });
  } else {
    const localAssistReady = profileId !== "local-assist" || input.capabilities.localSidecarReady;
    rows.push({
      id: "enable-automatic-agents",
      kind: "change",
      before: metadata.enableAgents,
      after: true,
      selectedByDefault: localAssistReady && metadata.enableAgents === undefined,
      selectable: localAssistReady,
      expectedExtraCalls: 0,
      destination: "Automatic roleplay agents",
      prerequisites: localAssistReady ? [] : ["The local sidecar must be ready before adding Local Assist agents."],
      warnings: [],
    });
  }

  const agentRows = [...recipe.agentIds, ...(recipe.optionalAgentIds ?? [])];
  for (const agentId of agentRows) {
    const isIllustrator = agentId === BUILT_IN_AGENT_IDS.ILLUSTRATOR;
    const isBackground = agentId === BUILT_IN_AGENT_IDS.BACKGROUND;
    const isMusic = agentId === BUILT_IN_AGENT_IDS.MUSIC_DJ;
    const backgroundReady = input.capabilities.hasUsableBackgroundAssets || input.capabilities.hasImageConnection;
    const localAssistReady = profileId !== "local-assist" || input.capabilities.localSidecarReady;
    const selectable =
      localAssistReady &&
      (isIllustrator
        ? input.capabilities.hasImageConnection
        : isBackground
          ? backgroundReady
          : isMusic
            ? input.capabilities.musicModuleEnabled
            : true);
    const prerequisites = !localAssistReady
      ? ["The local sidecar must be ready before adding Local Assist agents."]
      : isIllustrator
        ? input.capabilities.hasImageConnection
          ? []
          : ["A compatible image connection is required for Illustrator."]
        : isBackground
          ? backgroundReady
            ? []
            : ["Background needs usable background assets or a configured image connection."]
          : isMusic && !input.capabilities.musicModuleEnabled
            ? ["The optional Music module must be enabled before adding Music Player."]
            : [];
    const imageConnectionLabel = input.capabilities.imageConnection?.label.trim() || "Configured image connection";
    const illustratorWarning =
      input.capabilities.imageConnection?.mayUsePaidOrExternalService === false
        ? "Configured image connection reports no paid or external provider use."
        : "Image generation may use paid or external provider services.";
    const destination = isMusic
      ? "YouTube/external music data"
      : isIllustrator
        ? `${imageConnectionLabel} (configured image connection)`
        : isBackground
          ? input.capabilities.hasUsableBackgroundAssets
            ? "Your background assets"
            : imageConnectionLabel
          : "Automatic roleplay agent";
    rows.push({
      id: `agent:${agentId}`,
      kind: "change",
      before: activeAgentIds,
      after: [...new Set([...activeAgentIds, agentId])],
      selectedByDefault:
        selectable && metadata.enableAgents !== false && !isIllustrator && !isMusic && !activeAgentIds.includes(agentId),
      selectable,
      expectedExtraCalls: 1,
      destination,
      prerequisites,
      warnings: isIllustrator
        ? [illustratorWarning]
        : isBackground && input.capabilities.hasImageConnection && !input.capabilities.hasUsableBackgroundAssets
          ? ["Image generation may use a paid or external provider."]
          : isMusic
            ? ["Music Player uses YouTube/external music data."]
            : [],
    });
  }

  for (const [agentId, interval] of Object.entries(recipe.runIntervalOverrides ?? {})) {
    rows.push({
      id: `cadence:${agentId}`,
      kind: "change",
      before: agentRunIntervalOverrides[agentId],
      after: interval,
      selectedByDefault: agentRunIntervalOverrides[agentId] === undefined,
      selectable: true,
      expectedExtraCalls: 0,
      destination: "Automatic roleplay agent",
      prerequisites: [],
      warnings: [],
    });
  }

  for (const [agentId, connectionId] of Object.entries(recipe.connectionOverrides ?? {})) {
    const agentSelectedByDefault = rows.some(
      (row) => row.id === `agent:${agentId}` && row.kind === "change" && row.selectedByDefault,
    );
    rows.push({
      id: `connection:${agentId}`,
      kind: "change",
      before: agentConnectionOverrides[agentId],
      after: connectionId,
      selectedByDefault:
        metadata.enableAgents !== false &&
        input.capabilities.localSidecarReady &&
        agentConnectionOverrides[agentId] === undefined &&
        (activeAgentIds.includes(agentId) || agentSelectedByDefault),
      selectable: input.capabilities.localSidecarReady,
      expectedExtraCalls: 0,
      destination: "Local sidecar model",
      prerequisites: input.capabilities.localSidecarReady
        ? []
        : ["The local sidecar must be ready before routing agents to it."],
      warnings: [],
    });
  }

  if (!input.capabilities.musicModuleEnabled) {
    rows.push(informationRow("prerequisite:music-module", "Enable the optional Music module for playback controls."));
  }
  rows.push(
    informationRow(
      "information:tts-readiness",
      input.capabilities.ttsReady
        ? "Text-to-speech is ready; this profile leaves it unchanged."
        : "Text-to-speech is not ready; this profile leaves it unchanged.",
    ),
  );

  return {
    profileId,
    version: recipe.version,
    rows,
    baseline: {
      promptPresetId: input.chat.promptPresetId,
      metadata: {
        enableMemoryRecall: metadata.enableMemoryRecall,
        enableAgents: metadata.enableAgents,
        activeAgentIds: [...activeAgentIds],
        agentConnectionOverrides: { ...agentConnectionOverrides },
        agentRunIntervalOverrides: { ...agentRunIntervalOverrides },
      },
    },
  };
}

export function buildRoleplayWorkflowProfilePatch(
  resolution: RoleplayWorkflowProfileResolution,
  itemIds: readonly string[],
  appliedAt: string,
): RoleplayWorkflowProfilePatch {
  const selectedItemIds = [...new Set(itemIds)];
  const rows = new Map(resolution.rows.map((row) => [row.id, row]));
  for (const itemId of selectedItemIds) {
    const row = rows.get(itemId);
    if (!row || row.kind !== "change" || !row.selectable) {
      throw new Error(`Workflow item ${itemId} is not selectable in this resolution.`);
    }
  }

  const selected = new Set(selectedItemIds);
  validateLocalAssistSelection(resolution, selected);
  validateAgentEnablementSelection(resolution, selected);
  const changes: RoleplayWorkflowApplicationChange[] = [];
  const metadata: Partial<ChatMetadata> = {};
  const patch: RoleplayWorkflowProfilePatch = { metadata };
  const baseline = resolution.baseline.metadata;

  if (selected.has("prompt-preset")) {
    patch.promptPresetId = DE_KOI_UNIVERSAL_PRESET_ID;
    changes.push({
      itemIds: ["prompt-preset"],
      field: "promptPresetId",
      before: resolution.baseline.promptPresetId,
      after: patch.promptPresetId,
    });
  }
  if (selected.has("memory-recall")) {
    metadata.enableMemoryRecall = true;
    changes.push({
      itemIds: ["memory-recall"],
      field: "metadata.enableMemoryRecall",
      before: baseline.enableMemoryRecall,
      after: true,
    });
  }
  if (selected.has("disable-automatic-agents")) {
    metadata.enableAgents = false;
    metadata.activeAgentIds = [];
    changes.push(
      {
        itemIds: ["disable-automatic-agents"],
        field: "metadata.enableAgents",
        before: baseline.enableAgents,
        after: false,
      },
      {
        itemIds: ["disable-automatic-agents"],
        field: "metadata.activeAgentIds",
        before: baseline.activeAgentIds,
        after: [],
      },
    );
  } else {
    if (selected.has("enable-automatic-agents")) {
      metadata.enableAgents = true;
      changes.push({
        itemIds: ["enable-automatic-agents"],
        field: "metadata.enableAgents",
        before: baseline.enableAgents,
        after: true,
      });
    }
    const selectedAgentIds = selectedItemIds
      .filter((itemId) => itemId.startsWith("agent:"))
      .map((itemId) => itemId.slice("agent:".length));
    const activeAgentIds = [...new Set([...(baseline.activeAgentIds ?? []), ...selectedAgentIds])];
    if (selectedAgentIds.length > 0) {
      metadata.activeAgentIds = activeAgentIds;
      changes.push({
        itemIds: selectedItemIds.filter((itemId) => itemId.startsWith("agent:")),
        field: "metadata.activeAgentIds",
        before: baseline.activeAgentIds,
        after: activeAgentIds,
      });
    }
  }

  const selectedCadenceIds = selectedItemIds.filter((itemId) => itemId.startsWith("cadence:"));
  if (selectedCadenceIds.length > 0) {
    const next = { ...(baseline.agentRunIntervalOverrides ?? {}) };
    for (const itemId of selectedCadenceIds) {
      const agentId = itemId.slice("cadence:".length);
      next[agentId] = Number(rows.get(itemId)?.after);
    }
    metadata.agentRunIntervalOverrides = next;
    changes.push({
      itemIds: selectedCadenceIds,
      field: "metadata.agentRunIntervalOverrides",
      before: baseline.agentRunIntervalOverrides,
      after: next,
    });
  }

  const selectedConnectionIds = selectedItemIds.filter((itemId) => itemId.startsWith("connection:"));
  if (selectedConnectionIds.length > 0) {
    const next = { ...(baseline.agentConnectionOverrides ?? {}) };
    for (const itemId of selectedConnectionIds) {
      const agentId = itemId.slice("connection:".length);
      next[agentId] = String(rows.get(itemId)?.after);
    }
    metadata.agentConnectionOverrides = next;
    changes.push({
      itemIds: selectedConnectionIds,
      field: "metadata.agentConnectionOverrides",
      before: baseline.agentConnectionOverrides,
      after: next,
    });
  }

  metadata.roleplayWorkflowApplication = {
    profileId: resolution.profileId,
    profileVersion: resolution.version,
    appliedAt,
    selectedItemIds,
    changes,
  };
  return patch;
}

export function selectedLocalAssistAgentIds(
  resolution: RoleplayWorkflowProfileResolution,
  selectedItemIds: ReadonlySet<string>,
): string[] {
  const localConnectionAgentIds = resolution.rows
    .filter((row) => row.id.startsWith("connection:") && row.after === LOCAL_SIDECAR_CONNECTION_ID)
    .map((row) => row.id.slice("connection:".length));
  const selectedAgentIds: string[] = [];
  for (const agentId of localConnectionAgentIds) {
    const agentSelected = selectedItemIds.has(`agent:${agentId}`);
    const connectionSelected = selectedItemIds.has(`connection:${agentId}`);
    if (!agentSelected && !connectionSelected) continue;
    const alreadyActive = resolution.baseline.metadata.activeAgentIds?.includes(agentId) === true;
    const alreadyRouted =
      resolution.baseline.metadata.agentConnectionOverrides?.[agentId] === LOCAL_SIDECAR_CONNECTION_ID;
    if (agentSelected && !connectionSelected && !alreadyRouted) {
      throw new Error(`Local Assist agent ${agentId} needs its local sidecar route selected.`);
    }
    if (connectionSelected && !agentSelected && !alreadyActive) {
      throw new Error(`Local Assist route ${agentId} needs its active agent selected.`);
    }
    selectedAgentIds.push(agentId);
  }
  return selectedAgentIds;
}

function validateLocalAssistSelection(
  resolution: RoleplayWorkflowProfileResolution,
  selectedItemIds: ReadonlySet<string>,
): void {
  selectedLocalAssistAgentIds(resolution, selectedItemIds);
}

function validateAgentEnablementSelection(
  resolution: RoleplayWorkflowProfileResolution,
  selectedItemIds: ReadonlySet<string>,
): void {
  const selectsAgent = [...selectedItemIds].some((itemId) => itemId.startsWith("agent:"));
  if (
    selectsAgent &&
    resolution.baseline.metadata.enableAgents !== true &&
    !selectedItemIds.has("enable-automatic-agents")
  ) {
    throw new Error("Selected profile agents require enable-automatic-agents to be selected.");
  }
}

export function buildRoleplayWorkflowProfileRevertPatch(
  current: { promptPresetId: string | null; metadata: Partial<ChatMetadata> },
  receipt: RoleplayWorkflowApplicationReceipt,
): RoleplayWorkflowProfileRevertResult {
  const metadata: Partial<ChatMetadata> = { roleplayWorkflowApplication: null };
  const patch: RoleplayWorkflowProfilePatch = { metadata };
  const skippedConflicts: string[] = [];

  for (const change of receipt.changes) {
    const currentValue = currentValueForReceiptField(current, change.field);
    if (!sameValue(currentValue, change.after)) {
      skippedConflicts.push(...change.itemIds);
      continue;
    }
    applyReceiptBeforeValue(patch, change);
  }
  return { patch, skippedConflicts: [...new Set(skippedConflicts)] };
}

function currentValueForReceiptField(
  current: { promptPresetId: string | null; metadata: Partial<ChatMetadata> },
  field: RoleplayWorkflowApplicationChange["field"],
): unknown {
  switch (field) {
    case "promptPresetId":
      return current.promptPresetId;
    case "metadata.agentConnectionOverrides":
      return current.metadata.agentConnectionOverrides ?? {};
    case "metadata.agentRunIntervalOverrides":
      return current.metadata.agentRunIntervalOverrides ?? {};
    case "metadata.enableMemoryRecall":
      return current.metadata.enableMemoryRecall;
    case "metadata.enableAgents":
      return current.metadata.enableAgents;
    case "metadata.activeAgentIds":
      return current.metadata.activeAgentIds ?? [];
  }
}

function applyReceiptBeforeValue(patch: RoleplayWorkflowProfilePatch, change: RoleplayWorkflowApplicationChange): void {
  switch (change.field) {
    case "promptPresetId":
      patch.promptPresetId = change.before as string | null;
      return;
    case "metadata.enableMemoryRecall":
      patch.metadata.enableMemoryRecall = change.before as boolean | undefined;
      return;
    case "metadata.enableAgents":
      patch.metadata.enableAgents = change.before as boolean | undefined;
      return;
    case "metadata.activeAgentIds":
      patch.metadata.activeAgentIds = change.before as string[];
      return;
    case "metadata.agentConnectionOverrides":
      patch.metadata.agentConnectionOverrides = change.before as Record<string, string | null>;
      return;
    case "metadata.agentRunIntervalOverrides":
      patch.metadata.agentRunIntervalOverrides = change.before as Record<string, number>;
      return;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function informationRow(id: string, message: string): RoleplayWorkflowChangeRow {
  return {
    id,
    kind: "information",
    before: null,
    after: null,
    selectedByDefault: false,
    selectable: false,
    expectedExtraCalls: 0,
    destination: null,
    prerequisites: [message],
    warnings: [],
  };
}
