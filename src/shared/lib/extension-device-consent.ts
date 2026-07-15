import type { InstalledExtension } from "../../engine/contracts/types/extension";

export const EXTENSION_CONSENT_STORAGE_KEY = "de-koi.extension-device-consent.v1";
export const EXTENSION_CONSENT_CHANGED_EVENT = "de-koi-extension-consent-updated";

export interface ExtensionConsentChangedDetail {
  all?: boolean;
  runtimeScope?: string;
  extensionId?: string;
}

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

function dispatchConsentChanged(detail: ExtensionConsentChangedDetail = {}) {
  globalThis.dispatchEvent?.(
    new CustomEvent<ExtensionConsentChangedDetail>(EXTENSION_CONSENT_CHANGED_EVENT, { detail }),
  );
}

function writeEnvelope(storage: ConsentStorage, envelope: ConsentEnvelope, detail: ExtensionConsentChangedDetail) {
  storage.setItem(EXTENSION_CONSENT_STORAGE_KEY, JSON.stringify(envelope));
  dispatchConsentChanged(detail);
}

export function extensionConsentEventAffects(
  event: Event,
  runtimeScope: string,
  extensionId: string | readonly string[],
) {
  const detail = (event as CustomEvent<ExtensionConsentChangedDetail>).detail;
  if (!detail) return false;
  if (detail.all === true) return true;
  if (!detail.runtimeScope && !detail.extensionId) return false;
  if (detail.runtimeScope && detail.runtimeScope !== runtimeScope) return false;
  if (!detail.extensionId) return true;
  return Array.isArray(extensionId) ? extensionId.includes(detail.extensionId) : extensionId === detail.extensionId;
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

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

function rotateRight(value: number, count: number) {
  return (value >>> count) | (value << (32 - count));
}

function sha256Fallback(input: Uint8Array) {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash: number[] = [...SHA256_INITIAL];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0;
      const right = words[index - 2] ?? 0;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + upper + choice + SHA256_ROUND[index] + words[index]) >>> 0;
      const lower = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (lower + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) {
      hash[index] = ((hash[index] ?? 0) + value) >>> 0;
    }
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(
  input: Uint8Array,
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle,
) {
  if (!subtle) return sha256Fallback(input);
  const digest = await subtle.digest("SHA-256", Uint8Array.from(input).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extensionConsentFingerprint(extension: InstalledExtension): Promise<string> {
  // Fingerprints intentionally contain only canonical package data. Browser-specific entropy would make the Web
  // Crypto and deterministic SHA-256 paths disagree and revoke valid consent when the runtime capability changes.
  return sha256Hex(new TextEncoder().encode(canonicalExtension(extension)));
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
    writeEnvelope(storage, envelope, { runtimeScope, extensionId });
  },
  revoke(runtimeScope: string, extensionId: string, storage: ConsentStorage = localStorage) {
    const envelope = readEnvelope(storage);
    delete envelope.records[recordKey(runtimeScope, extensionId)];
    writeEnvelope(storage, envelope, { runtimeScope, extensionId });
  },
  clearRuntime(runtimeScope: string, storage: ConsentStorage = localStorage) {
    const envelope = readEnvelope(storage);
    for (const key of Object.keys(envelope.records)) {
      if (key.startsWith(`${runtimeScope.trim()}\n`)) delete envelope.records[key];
    }
    writeEnvelope(storage, envelope, { runtimeScope });
  },
  clearAll(storage: ConsentStorage = localStorage) {
    storage.removeItem(EXTENSION_CONSENT_STORAGE_KEY);
    dispatchConsentChanged({ all: true });
  },
};
