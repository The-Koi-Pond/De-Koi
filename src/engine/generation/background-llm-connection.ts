import type { StorageGateway } from "../capabilities/storage";
import type { HelperRunRule } from "./helper-runs";
import { boolish, readString, type JsonRecord } from "./runtime-records";

function isEnabledTextConnection(connection: JsonRecord): boolean {
  return (
    readString(connection.id).trim().length > 0 &&
    readString(connection.provider).trim() !== "image_generation" &&
    boolish(connection.enabled, true)
  );
}

export function selectBackgroundTextConnection(
  connections: readonly JsonRecord[],
  fallbackConnectionId?: string | null,
  fallbackModel?: string | null,
): JsonRecord | null {
  const available = connections.filter(isEnabledTextConnection);
  const fallback = readString(fallbackConnectionId).trim();
  const fallbackModelId = readString(fallbackModel).trim();
  const fallbackConnection = fallback
    ? (available.find((connection) => readString(connection.id).trim() === fallback) ??
      (fallbackModelId ? { id: fallback, model: fallbackModelId } : undefined))
    : undefined;
  return (
    available.find((connection) => boolish(connection.defaultForAgents, false)) ??
    fallbackConnection ??
    available.find((connection) => boolish(connection.isDefault, false) || boolish(connection.default, false)) ??
    available[0] ??
    null
  );
}

/** Which step of {@link selectBackgroundTextConnection} picked `connection`, for helper run notes. */
export function backgroundConnectionRule(connection: JsonRecord, fallbackConnectionId?: string | null): HelperRunRule {
  if (boolish(connection.defaultForAgents, false)) return "agentDefault";
  const id = readString(connection.id).trim();
  if (id && id === readString(fallbackConnectionId).trim()) return "chat";
  if (boolish(connection.isDefault, false) || boolish(connection.default, false)) return "appDefault";
  return "first";
}

export async function resolveBackgroundTextConnection(
  storage: StorageGateway,
  fallbackConnectionId?: string | null,
  fallbackModel?: string | null,
): Promise<JsonRecord> {
  const selected = selectBackgroundTextConnection(
    await storage.list<JsonRecord>("connections"),
    fallbackConnectionId,
    fallbackModel,
  );
  if (!selected) throw new Error("No text connection is available");
  return selected;
}
