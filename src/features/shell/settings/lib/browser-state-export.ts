export type BrowserStateExportMode = "safe" | "recovery";

export interface BrowserStateExportInput {
  mode: BrowserStateExportMode;
  exportedAt: string;
  origin: string | null;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface BrowserStateExportPayload {
  schema: "de-koi-browser-support-state-v1" | "de-koi-browser-local-state-v1";
  exportedAt: string;
  origin: string | null;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

const ADMIN_SECRET_STORAGE_KEYS = new Set([ADMIN_SECRET_STORAGE_KEY, LEGACY_ADMIN_SECRET_STORAGE_KEY]);

function redactStoredValue(value: string): string {
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(value)));
  } catch {
    const redacted = redactSensitiveValue(value);
    return typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  }
}

function safeStorageEntries(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([key]) => !ADMIN_SECRET_STORAGE_KEYS.has(key))
      .map(([key, value]) => [key, redactStoredValue(value)]),
  );
}

export function buildBrowserStateExportPayload(input: BrowserStateExportInput): BrowserStateExportPayload {
  if (input.mode === "safe") {
    const redactedOrigin = input.origin === null ? null : redactSensitiveValue(input.origin);
    return {
      schema: "de-koi-browser-support-state-v1",
      exportedAt: input.exportedAt,
      origin: typeof redactedOrigin === "string" ? redactedOrigin : null,
      localStorage: safeStorageEntries(input.localStorage),
      sessionStorage: safeStorageEntries(input.sessionStorage),
    };
  }

  return {
    schema: "de-koi-browser-local-state-v1",
    exportedAt: input.exportedAt,
    origin: input.origin,
    localStorage: input.localStorage,
    sessionStorage: input.sessionStorage,
  };
}
import {
  ADMIN_SECRET_STORAGE_KEY,
  LEGACY_ADMIN_SECRET_STORAGE_KEY,
} from "../../../../shared/api/remote-runtime";
import { redactSensitiveValue } from "../../../../shared/lib/sensitive-data-redaction";
