import type { InstalledExtension } from "../../engine/contracts/types/extension";

export const EXTENSION_CONSENT_STORAGE_KEY = "de-koi.extension-device-consent.v1";
export const EXTENSION_CONSENT_CHANGED_EVENT = "de-koi-extension-consent-updated";

export interface ExtensionDeviceConsent {
  css: boolean;
  javascript: boolean;
  fingerprint: string;
  grantedAt: string;
}

interface ConsentEnvelope {
  version: 1;
  records: Record<string, ExtensionDeviceConsent>;
}

type ConsentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function recordKey(runtimeScope: string, extensionId: string) {
  return `${runtimeScope.trim()}\n${extensionId.trim()}`;
}

function readEnvelope(storage: ConsentStorage): ConsentEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(EXTENSION_CONSENT_STORAGE_KEY) ?? "null") as Partial<ConsentEnvelope>;
    if (parsed?.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
      return { version: 1, records: {} };
    }
    return { version: 1, records: parsed.records };
  } catch {
    return { version: 1, records: {} };
  }
}

function writeEnvelope(storage: ConsentStorage, envelope: ConsentEnvelope) {
  storage.setItem(EXTENSION_CONSENT_STORAGE_KEY, JSON.stringify(envelope));
  globalThis.dispatchEvent?.(new Event(EXTENSION_CONSENT_CHANGED_EVENT));
}

function canonicalExtension(extension: InstalledExtension) {
  return JSON.stringify({
    id: extension.id,
    packageId: extension.packageId ?? null,
    packageVersion: extension.packageVersion ?? null,
    css: extension.css ?? null,
    js: extension.js ?? null,
    permissions: [...(extension.permissions ?? [])].sort(),
    source: extension.source ?? null,
  });
}

export async function extensionConsentFingerprint(extension: InstalledExtension): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure extension fingerprinting is unavailable on this device.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalExtension(extension)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const extensionDeviceConsentStore = {
  read(runtimeScope: string, extensionId: string, fingerprint: string, storage: ConsentStorage = localStorage) {
    const record = readEnvelope(storage).records[recordKey(runtimeScope, extensionId)];
    return record?.fingerprint === fingerprint ? record : null;
  },
  grant(
    runtimeScope: string,
    extensionId: string,
    fingerprint: string,
    activation: Pick<ExtensionDeviceConsent, "css" | "javascript">,
    storage: ConsentStorage = localStorage,
  ) {
    const envelope = readEnvelope(storage);
    envelope.records[recordKey(runtimeScope, extensionId)] = {
      ...activation,
      fingerprint,
      grantedAt: new Date().toISOString(),
    };
    writeEnvelope(storage, envelope);
  },
  revoke(runtimeScope: string, extensionId: string, storage: ConsentStorage = localStorage) {
    const envelope = readEnvelope(storage);
    delete envelope.records[recordKey(runtimeScope, extensionId)];
    writeEnvelope(storage, envelope);
  },
  clearRuntime(runtimeScope: string, storage: ConsentStorage = localStorage) {
    const envelope = readEnvelope(storage);
    for (const key of Object.keys(envelope.records)) {
      if (key.startsWith(`${runtimeScope.trim()}\n`)) delete envelope.records[key];
    }
    writeEnvelope(storage, envelope);
  },
  clearAll(storage: ConsentStorage = localStorage) {
    storage.removeItem(EXTENSION_CONSENT_STORAGE_KEY);
    globalThis.dispatchEvent?.(new Event(EXTENSION_CONSENT_CHANGED_EVENT));
  },
};
