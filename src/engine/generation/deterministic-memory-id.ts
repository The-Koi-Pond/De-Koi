import { sha256Hex } from "../../shared/lib/extension-device-consent";

function legacyHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function legacyMemoryId(prefix: string, identity: string): string {
  return `${prefix}-${legacyHash(identity)}`;
}

export async function sha256MemoryId(prefix: string, identity: string): Promise<string> {
  return `${prefix}-${await sha256Hex(new TextEncoder().encode(identity))}`;
}
