import { MUSIC_DJ_MINI_PLAYER_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { readAppSettingsValue } from "../../engine/contracts/app-settings-value";
import { readCoreModuleSettings } from "../../engine/contracts/core-module-settings";
import type { CoreModuleSettings } from "../../engine/contracts/types/core-module";
import { transformAppSettings } from "./app-settings-api";
import { storageApi } from "./storage-api";
import { isRecord } from "../../engine/shared/value-readers";

const CORE_MODULE_SETTINGS_ID = "core-modules";
const LEGACY_UI_STORE_NAME = "marinara-engine-ui-tauri";

type AppSettingsRecord = {
  value?: unknown;
};

export function settingsFromLegacyUiStorageValue(value: string | null): CoreModuleSettings {
  if (!value) return readCoreModuleSettings(null);

  try {
    const parsed: unknown = JSON.parse(value);
    const state = isRecord(parsed) ? parsed.state : null;
    // `spotifyPlayerEnabled` is the switch's name before the UI store renamed it.
    const musicPlayerEnabled =
      isRecord(state) && (state.musicPlayerEnabled === true || state.spotifyPlayerEnabled === true);
    return readCoreModuleSettings({
      enabled: musicPlayerEnabled ? { [MUSIC_DJ_MINI_PLAYER_MODULE_ID]: true } : {},
    });
  } catch {
    return readCoreModuleSettings(null);
  }
}

function legacyCoreModuleSettings(): CoreModuleSettings {
  if (typeof localStorage === "undefined") return readCoreModuleSettings(null);
  return settingsFromLegacyUiStorageValue(localStorage.getItem(LEGACY_UI_STORE_NAME));
}

async function readSettingsRecord(): Promise<CoreModuleSettings> {
  const record = await storageApi.get<AppSettingsRecord>("app-settings", CORE_MODULE_SETTINGS_ID);
  if (!record) return legacyCoreModuleSettings();
  return readCoreModuleSettings(readAppSettingsValue(record));
}

/**
 * Applies `change` to the stored core module settings with a compare-and-set
 * write, so a module toggled on another client at the same time stays toggled.
 */
async function updateSettingsRecord(
  change: (current: CoreModuleSettings) => CoreModuleSettings,
): Promise<CoreModuleSettings> {
  // Loaded on use: a write is checked against the zod schema, which the startup read above does not need.
  const { coreModuleSettingsSchema } = await import("../../engine/contracts/schemas/core-module.schema");
  const normalizeSettings = (value: unknown): CoreModuleSettings => coreModuleSettingsSchema.parse(value ?? undefined);
  const value = await transformAppSettings(CORE_MODULE_SETTINGS_ID, "core module settings", (stored, exists) =>
    normalizeSettings(change(exists ? readCoreModuleSettings(stored) : legacyCoreModuleSettings())),
  );
  return normalizeSettings(value);
}

export const coreModulesApi = {
  settings: {
    get: readSettingsRecord,
    setEnabled: (moduleId: string, enabled: boolean) =>
      updateSettingsRecord((current) => ({ enabled: { ...current.enabled, [moduleId]: enabled } })),
  },
};
