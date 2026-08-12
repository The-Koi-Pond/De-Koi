import type { StorageGateway } from "../capabilities/storage";
import { readString, type JsonRecord } from "./runtime-records";

export async function loadAgentMemory(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
): Promise<Record<string, unknown>> {
  const rows = await storage.list<JsonRecord>("agent-memory", { filters: { agentConfigId: agentId, chatId } });
  const memory: Record<string, unknown> = {};
  for (const row of rows) {
    if (readString(row.agentConfigId) !== agentId || readString(row.chatId) !== chatId) continue;
    const key = readString(row.key);
    if (!key) continue;
    memory[key] = parseMaybeJson(row.value);
  }
  return memory;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
