import type { StorageGateway } from "../capabilities/storage";
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
  const fallbackConnection = fallback
    ? (available.find((connection) => readString(connection.id).trim() === fallback) ?? {
        id: fallback,
        ...(readString(fallbackModel).trim() ? { model: readString(fallbackModel).trim() } : {}),
      })
    : undefined;
  return (
    available.find((connection) => boolish(connection.defaultForAgents, false)) ??
    fallbackConnection ??
    available.find((connection) => boolish(connection.isDefault, false) || boolish(connection.default, false)) ??
    available[0] ??
    null
  );
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
