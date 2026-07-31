import type { AgentResult } from "../contracts/types/agent";
import {
  normalizeConversationCraftState,
  type ConversationCraftState,
} from "../contracts/constants/conversation-craft";
import type { StorageGateway } from "../capabilities/storage";
import { isRecord, nowIso, readString, type JsonRecord } from "./runtime-records";
import {
  narrativeCraftStateFromLegacyMemory,
  normalizeNarrativeCraftState,
  type NarrativeCraftState,
} from "./narrative-craft-state";

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

export async function loadNarrativeCraftState(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
): Promise<NarrativeCraftState | null> {
  const currentMemory = await loadAgentMemory(storage, agentId, chatId);
  if (Object.prototype.hasOwnProperty.call(currentMemory, "state")) {
    return normalizeNarrativeCraftState(currentMemory.state);
  }

  const agentRows = await storage.list<JsonRecord>("agents");
  const storedLegacyIds = agentRows
    .filter((row) => readString(row.type || row.agentType) === "secret-plot-driver")
    .map((row) => readString(row.id))
    .filter(Boolean);
  const legacyIds = Array.from(new Set(["secret-plot-driver", "builtin:secret-plot-driver", ...storedLegacyIds]));

  for (const legacyId of legacyIds) {
    const memory = await loadAgentMemory(storage, legacyId, chatId);
    if (
      ["overarchingArc", "sceneDirections", "pacing", "recentlyFulfilled", "staleDetected"].some((key) =>
        Object.prototype.hasOwnProperty.call(memory, key),
      )
    ) {
      return narrativeCraftStateFromLegacyMemory(memory);
    }
  }
  return null;
}

export async function persistNarrativeCraftAgentMemory(
  storage: StorageGateway,
  chatId: string,
  results: AgentResult[],
): Promise<void> {
  const result = results.find(
    (entry) =>
      entry.success &&
      entry.agentType === "narrative-craft" &&
      entry.type === "context_injection" &&
      isRecord(entry.data) &&
      isRecord(entry.data.state),
  );
  if (!result || !isRecord(result.data) || !isRecord(result.data.state)) return;
  const directive = result.data.intervened === true ? readString(result.data.text).trim() : "";
  await setAgentMemoryValue(storage, result.agentId, chatId, "state", {
    ...normalizeNarrativeCraftState(result.data.state),
    pendingGuidance: directive ? [directive] : [],
    lastAnalysisReason: readString(result.data.reason).trim(),
  });
}

export async function loadConversationCraftState(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
): Promise<ConversationCraftState | null> {
  const memory = await loadAgentMemory(storage, agentId, chatId);
  if (!Object.prototype.hasOwnProperty.call(memory, "state")) return null;
  return normalizeConversationCraftState(memory.state);
}

export async function persistConversationCraftAgentMemory(
  storage: StorageGateway,
  chatId: string,
  results: AgentResult[],
): Promise<void> {
  const result = results.find(
    (entry) =>
      entry.success &&
      entry.agentType === "conversation-craft" &&
      entry.type === "context_injection" &&
      isRecord(entry.data) &&
      isRecord(entry.data.state),
  );
  if (!result || !isRecord(result.data) || !isRecord(result.data.state)) return;
  const directive = result.data.intervened === true ? readString(result.data.text).trim() : "";
  await setAgentMemoryValue(storage, result.agentId, chatId, "state", {
    ...normalizeConversationCraftState(result.data.state),
    pendingGuidance: directive ? [directive] : [],
    lastAnalysisReason: readString(result.data.reason).trim(),
  });
}

export async function consumeConversationCraftPendingGuidance(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
): Promise<string | null> {
  const preferredMemory = await loadAgentMemory(storage, agentId, chatId);
  if (Object.prototype.hasOwnProperty.call(preferredMemory, "state")) {
    return consumeConversationCraftStateGuidance(storage, agentId, chatId, preferredMemory.state);
  }

  const configuredIds = (await storage.list<JsonRecord>("agents"))
    .filter((row) => readString(row.type || row.agentType).trim() === "conversation-craft")
    .map((row) => readString(row.id).trim())
    .filter((id) => id && id !== agentId);
  for (const configuredId of configuredIds) {
    const memory = await loadAgentMemory(storage, configuredId, chatId);
    if (!Object.prototype.hasOwnProperty.call(memory, "state")) continue;
    return consumeConversationCraftStateGuidance(storage, configuredId, chatId, memory.state);
  }
  return null;
}

async function consumeConversationCraftStateGuidance(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
  value: unknown,
): Promise<string | null> {
  const state = normalizeConversationCraftState(value);
  const guidance = state.pendingGuidance[0]?.trim() ?? "";
  if (!guidance) return null;
  await setAgentMemoryValue(storage, agentId, chatId, "state", {
    ...state,
    pendingGuidance: [],
  });
  return guidance;
}

export async function consumeNarrativeCraftPendingGuidance(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
): Promise<string | null> {
  const preferredMemory = await loadAgentMemory(storage, agentId, chatId);
  if (Object.prototype.hasOwnProperty.call(preferredMemory, "state")) {
    return consumeNarrativeCraftStateGuidance(storage, agentId, chatId, preferredMemory.state);
  }

  const configuredIds = (await storage.list<JsonRecord>("agents"))
    .filter((row) => readString(row.type || row.agentType).trim() === "narrative-craft")
    .map((row) => readString(row.id).trim())
    .filter((id) => id && id !== agentId);
  for (const configuredId of configuredIds) {
    const memory = await loadAgentMemory(storage, configuredId, chatId);
    if (!Object.prototype.hasOwnProperty.call(memory, "state")) continue;
    return consumeNarrativeCraftStateGuidance(storage, configuredId, chatId, memory.state);
  }
  return null;
}

async function consumeNarrativeCraftStateGuidance(
  storage: StorageGateway,
  agentId: string,
  chatId: string,
  value: unknown,
): Promise<string | null> {
  const state = normalizeNarrativeCraftState(value);
  const guidance = state.pendingGuidance[0]?.trim() ?? "";
  if (!guidance) return null;
  await setAgentMemoryValue(storage, agentId, chatId, "state", {
    ...state,
    pendingGuidance: [],
  });
  return guidance;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function setAgentMemoryValue(
  storage: StorageGateway,
  agentConfigId: string,
  chatId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const storedValue = typeof value === "string" ? value : JSON.stringify(value);
  const rows = await storage.list<JsonRecord>("agent-memory", { filters: { agentConfigId, chatId, key } });
  const existing = rows.find(
    (row) =>
      readString(row.agentConfigId) === agentConfigId &&
      readString(row.chatId) === chatId &&
      readString(row.key) === key,
  );
  const updatedAt = nowIso();
  if (existing) {
    const id = readString(existing.id).trim();
    if (id) await storage.update("agent-memory", id, { value: storedValue, updatedAt });
    return;
  }
  await storage.create("agent-memory", {
    agentConfigId,
    chatId,
    key,
    value: storedValue,
    updatedAt,
  });
}
