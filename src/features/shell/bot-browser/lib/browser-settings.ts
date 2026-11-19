import { isRecord } from "../../../../engine/shared/value-readers";
import type { ProviderId } from "./providers/types";

/** Stored contract: the key and shape the Browser has always saved under. */
export const BROWSER_SETTINGS_KEY = "marinara-bot-browser";

export type LoginProviderId = "pygmalion" | "chartavern";

export interface BrowserSettings {
  nsfw: Partial<Record<ProviderId, boolean>>;
  logins: Partial<Record<LoginProviderId, boolean>>;
}

function readStoredObject(): Record<string, unknown> {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(BROWSER_SETTINGS_KEY);
  } catch (error) {
    console.warn("[bot-browser] Couldn't read the saved browser settings.", error);
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    // A value that isn't JSON is treated as empty settings (decision 5); the next save replaces it.
    return {};
  }
}

function booleanMap<K extends string>(value: unknown): Partial<Record<K, boolean>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<K, boolean>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") result[key as K] = entry;
  }
  return result;
}

/** The saved settings; a missing or wrongly shaped part reads as empty. */
export function readBrowserSettings(): BrowserSettings {
  const stored = readStoredObject();
  return { nsfw: booleanMap<ProviderId>(stored.nsfw), logins: booleanMap<LoginProviderId>(stored.logins) };
}

/** Writes one change back into the whole stored object, keeping every other key in it. */
function updateBrowserSettings(change: (settings: BrowserSettings) => void): BrowserSettings {
  const stored = readStoredObject();
  const settings: BrowserSettings = {
    nsfw: booleanMap<ProviderId>(stored.nsfw),
    logins: booleanMap<LoginProviderId>(stored.logins),
  };
  change(settings);
  const next = {
    ...stored,
    nsfw: { ...(isRecord(stored.nsfw) ? stored.nsfw : {}), ...settings.nsfw },
    logins: { ...(isRecord(stored.logins) ? stored.logins : {}), ...settings.logins },
  };
  try {
    window.localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("[bot-browser] Couldn't save the browser settings.", error);
  }
  return settings;
}

export function saveProviderNsfw(provider: ProviderId, nsfw: boolean): BrowserSettings {
  return updateBrowserSettings((settings) => {
    settings.nsfw[provider] = nsfw;
  });
}

export function saveLogin(provider: LoginProviderId, loggedIn: boolean, nsfw?: boolean): BrowserSettings {
  return updateBrowserSettings((settings) => {
    settings.logins[provider] = loggedIn;
    if (nsfw !== undefined) settings.nsfw[provider] = nsfw;
  });
}
