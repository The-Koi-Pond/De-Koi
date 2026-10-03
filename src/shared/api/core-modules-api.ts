import { MUSIC_DJ_MINI_PLAYER_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { appSettingsResponseSchema } from "../../engine/contracts/schemas/app-settings.schema";
import { coreModuleSettingsSchema } from "../../engine/contracts/schemas/core-module.schema";
import type { CoreModuleSettings } from "../../engine/contracts/types/core-module";
import { transformAppSettings } from "./app-settings-api";
import { storageApi } from "./storage-api";

const CORE_MODULE_SETTINGS_ID = "core-modules";
const LEGACY_UI_STORE_NAME = "marinara-engine-ui-tauri";

type AppSettingsRecord = {
  value?: unknown;
};

function normalizeSettings(value: unknown): CoreModuleSettings {
  return coreModuleSettingsSchema.parse(value ?? undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function settingsFromLegacyUiStorageValue(value: string | null): CoreModuleSettings {
  if (!value) return normalizeSettings(null);

  try {
    const parsed: unknown = JSON.parse(value);
    const state = isRecord(parsed) ? parsed.state : null;
    return normalizeSettings({
      enabled: isRecord(state) && state.spotifyPlayerEnabled === true ? { [MUSIC_DJ_MINI_PLAYER_MODULE_ID]: true } : {},
    });
  } catch {
    return normalizeSettings(null);
  }
}

function legacyCoreModuleSettings(): CoreModuleSettings {
  if (typeof localStorage === "undefined") return normalizeSettings(null);
  return settingsFromLegacyUiStorageValue(localStorage.getItem(LEGACY_UI_STORE_NAME));
}

async function readSettingsRecord(): Promise<CoreModuleSettings> {
  const record = await storageApi.get<AppSettingsRecord>("app-settings", CORE_MODULE_SETTINGS_ID);
  if (!record) return legacyCoreModuleSettings();
  const parsed = appSettingsResponseSchema.safeParse(record ?? { value: null });
  return normalizeSettings(parsed.success ? parsed.data.value : null);
}

/**
 * Applies `change` to the stored core module settings with a compare-and-set
 * write, so a module toggled on another client at the same time stays toggled.
 */
async function updateSettingsRecord(
  change: (current: CoreModuleSettings) => CoreModuleSettings,
): Promise<CoreModuleSettings> {
  const value = await transformAppSettings(CORE_MODULE_SETTINGS_ID, "core module settings", (stored, exists) =>
    normalizeSettings(change(exists ? normalizeSettings(stored) : legacyCoreModuleSettings())),
  );
  return normalizeSettings(value);
}

export const coreModulesApi = {
  settings: {
    get: readSettingsRecord,
    save: (settings: CoreModuleSettings) => updateSettingsRecord(() => settings),
    setEnabled: (moduleId: string, enabled: boolean) =>
      updateSettingsRecord((current) => ({ enabled: { ...current.enabled, [moduleId]: enabled } })),
  },
};
