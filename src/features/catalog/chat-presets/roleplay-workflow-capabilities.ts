import {
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
} from "../../../engine/contracts/constants/core-modules";
import type { Chat } from "../../../engine/contracts/types/chat";
import type { LocalSidecarStatusResponse } from "../../../engine/contracts/types/sidecar";
import type { RoleplayWorkflowCapabilities } from "../../../engine/modes/roleplay/workflow-profiles";
import { DE_KOI_UNIVERSAL_PRESET_ID } from "../../../engine/modes/roleplay/scene/universal-preset";
import { connectionCatalogApi, type AvailableConnectionSummary } from "../../../shared/api/connection-catalog-api";
import { coreModulesApi } from "../../../shared/api/core-modules-api";
import { localSidecarApi } from "../../../shared/api/local-sidecar-api";
import { backgroundsApi } from "../../../shared/api/settings-assets-api";
import { storageApi } from "../../../shared/api/storage-api";
import { ttsApi } from "../../../shared/api/tts-api";

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function localSidecarReady(status: LocalSidecarStatusResponse | null): boolean {
  if (!status) return false;
  const hasRuntime = status.runtime.installed || Boolean(status.config.executablePath?.trim());
  return Boolean(
    status.configured &&
    status.enabled &&
    status.modelDownloaded &&
    hasRuntime &&
    status.status === "ready" &&
    status.ready &&
    status.baseUrl,
  );
}

async function readOptionalLocalSidecarStatus(): Promise<LocalSidecarStatusResponse | null> {
  try {
    return await localSidecarApi.status();
  } catch {
    return null;
  }
}

function isLoopbackUrl(value: string | null | undefined): boolean {
  const url = value?.trim().toLowerCase() ?? "";
  return /^(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$)/.test(url);
}

function imageConnectionRisk(connection: AvailableConnectionSummary): boolean {
  return !isLoopbackUrl(connection.baseUrl);
}

type IllustratorAgentRecord = {
  id?: unknown;
  type?: unknown;
  settings?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function illustratorSettings(agent: IllustratorAgentRecord | undefined): Record<string, unknown> {
  if (typeof agent?.settings !== "string") return recordValue(agent?.settings);
  try {
    return recordValue(JSON.parse(agent.settings));
  } catch {
    return {};
  }
}

export function resolveRoleplayWorkflowImageCapability(input: {
  chat: { metadata?: unknown };
  agents: readonly IllustratorAgentRecord[];
  connections: readonly AvailableConnectionSummary[];
}): RoleplayWorkflowCapabilities["imageConnection"] {
  const agent = input.agents.find((candidate) => candidate.id === "illustrator" || candidate.type === "illustrator");
  const settings = illustratorSettings(agent);
  const metadata = recordValue(input.chat.metadata);
  const globalDefault = input.connections.find(
    (connection) => connection.provider === "image_generation" && boolish(connection.defaultForAgents),
  );
  const selectedId =
    (typeof settings.imageConnectionId === "string" ? settings.imageConnectionId.trim() : "") ||
    (typeof metadata.illustrationImageConnectionId === "string" ? metadata.illustrationImageConnectionId.trim() : "") ||
    globalDefault?.id.trim() ||
    "";
  if (!selectedId) return null;
  const connection = input.connections.find(
    (candidate) => candidate.id === selectedId && candidate.provider === "image_generation",
  );
  return connection
    ? {
        label: connection.name?.trim() || "Configured image connection",
        mayUsePaidOrExternalService: imageConnectionRisk(connection),
      }
    : null;
}

function usableBackgroundCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const item = row as { filename?: unknown; name?: unknown; path?: unknown; type?: unknown; isDirectory?: unknown };
    if (item.type === "folder" || item.isDirectory === true) return false;
    return [item.filename, item.name, item.path].some((candidate) => typeof candidate === "string" && candidate.trim());
  }).length;
}

export async function resolveRoleplayWorkflowCapabilities(chat: Chat): Promise<RoleplayWorkflowCapabilities> {
  const [universalPreset, connections, backgrounds, moduleSettings, ttsConfig, sidecarStatus, directAgent, agents] =
    await Promise.all([
      storageApi.get("prompts", DE_KOI_UNIVERSAL_PRESET_ID),
      connectionCatalogApi.listAvailable(),
      backgroundsApi.list(),
      coreModulesApi.settings.get(),
      ttsApi.config(),
      readOptionalLocalSidecarStatus(),
      storageApi.get<IllustratorAgentRecord>("agents", "illustrator").catch(() => null),
      storageApi.list<IllustratorAgentRecord>("agents").catch(() => []),
    ]);
  const imageConnection = resolveRoleplayWorkflowImageCapability({
    chat,
    agents: directAgent ? [directAgent, ...agents] : agents,
    connections,
  });

  return {
    hasUniversalPreset: Boolean(universalPreset),
    localSidecarReady: localSidecarReady(sidecarStatus),
    hasImageConnection: Boolean(imageConnection),
    imageConnection,
    hasUsableBackgroundAssets: usableBackgroundCount(backgrounds) > 0,
    musicModuleEnabled:
      moduleSettings.enabled[MUSIC_DJ_MINI_PLAYER_MODULE_ID] === true ||
      moduleSettings.enabled[LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID] === true,
    ttsReady: Boolean(ttsConfig.enabled && ttsConfig.baseUrl.trim() && ttsConfig.voice.trim()),
  };
}

export async function isLocalSidecarAssignmentReady(_agentId: string, _chat: Chat): Promise<boolean> {
  return localSidecarReady(await localSidecarApi.status());
}
