import { isRecord } from "../shared/value-readers";
import type { CoreModuleSettings } from "./types/core-module";

const CORE_MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const CORE_MODULE_ID_MAX_LENGTH = 80;

/**
 * Stored core module settings as valid settings: every `enabled` entry whose trimmed id and on/off value pass
 * `coreModuleSettingsSchema` is kept (by its trimmed id), the rest are dropped, so one bad entry neither blocks the
 * Modules screen nor resets the other modules. Written without zod so the home screen's startup read does not load it.
 */
export function readCoreModuleSettings(value: unknown): CoreModuleSettings {
  const stored = isRecord(value) && isRecord(value.enabled) ? value.enabled : {};
  const enabled: Record<string, boolean> = {};
  for (const [rawId, on] of Object.entries(stored)) {
    const id = rawId.trim();
    if (typeof on !== "boolean" || id.length > CORE_MODULE_ID_MAX_LENGTH || !CORE_MODULE_ID_PATTERN.test(id)) continue;
    enabled[id] = on;
  }
  return { enabled };
}
