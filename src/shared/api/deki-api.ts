import {
  normalizeDekiEntryAction,
  validateDekiRecordActionPayload,
  type DekiActionApplication,
  type DekiActionEntity,
  type DekiChatAccessGrant,
  type DekiEntryAction,
  type DekiEntryRequest,
  type DekiGatewayResponse,
  type DekiWorkspaceAbortResult,
  type DekiWorkspaceApprovalDecisionResult,
  type DekiWorkspaceHistoryEntry,
  type DekiWorkspaceHistoryItem,
  type DekiWorkspaceStatus,
  type DekiWorkspaceToolName,
  type DekiWorkspaceTraceItem,
  type DekiMessage,
} from "../../engine/deki/deki-entry";
import {
  createDekiSession,
  getActiveDekiSession,
  type DekiCompactionState,
  type DekiSession,
  type DekiSessionsState,
} from "../../engine/deki/deki-history";
import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import { createCharacterSchema } from "../../engine/contracts/schemas/character.schema";
import {
  createLorebookEntrySchema,
  createLorebookSchema,
  updateLorebookEntrySchema,
  updateLorebookSchema,
} from "../../engine/contracts/schemas/lorebook.schema";
import {
  createChoiceBlockSchema,
  createPromptGroupSchema,
  createPromptSectionSchema,
  updatePromptPresetSchema,
} from "../../engine/contracts/schemas/prompt.schema";
import type { StorageEntity } from "../../engine/capabilities/storage";
import { ApiError } from "./api-errors";
import { planDekiHistoryPersistence, type DekiHistoryPersistenceSnapshot } from "./deki-history-persistence";
import { remoteRuntimeTarget } from "./remote-runtime";
import { storageApi } from "./storage-api";
import { hasEmbeddedTauriIpc, invokeTauri } from "./tauri-client";
import { reportPerformanceStageTiming, type PerformanceDiagnosticsStageTiming } from "../lib/performance-diagnostics";

const DEKI_SETTINGS_ID = "deki";
const LEGACY_DEKI_SETTINGS_ID = "professor-mari";
const LEGACY_DEKI_SESSION_ID = "deki-session-default";

export type DekiPreferences = {
  selectedConnectionId: string | null;
  selectedPersonaId: string | null;
};

type DekiSettingsRecord = {
  value?: unknown;
};

type StoredMessageRecord = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
  action?: unknown;
  actionApplication?: unknown;
  workspaceTrace?: unknown;
  workspaceHistory?: unknown;
};

type DekiActionApplyResult = {
  entity: DekiActionEntity;
  storageEntity: StorageEntity;
  result: unknown;
  resultId: string | null;
  application: DekiActionApplication | null;
  messages: DekiMessage[] | null;
  compaction: DekiCompactionState | null;
};

type DekiActionCurrentRecordResult = {
  entity: DekiActionEntity;
  storageEntity: StorageEntity;
  id: string;
  record: Record<string, unknown> | null;
};

async function measureDekiStage<T>(
  name: Extract<PerformanceDiagnosticsStageTiming["name"], `deki.${string}`>,
  operation: () => Promise<T>,
  metadata: (result: T) => PerformanceDiagnosticsStageTiming["metadata"],
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    reportPerformanceStageTiming({ name, elapsedMs: Date.now() - startedAt, status: "ok", metadata: metadata(result) });
    return result;
  } catch (error) {
    reportPerformanceStageTiming({ name, elapsedMs: Date.now() - startedAt, status: "error" });
    throw error;
  }
}

type DekiHistorySnapshot = {
  session: DekiSession;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
};

type DekiSessionRecord = {
  id: string;
  title?: unknown;
  compaction?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type DekiMessageRecord = StoredMessageRecord & {
  sessionId?: unknown;
  sortOrder?: unknown;
};

const DEKI_ACTION_STORAGE_ENTITIES: Record<DekiActionEntity, StorageEntity> = {
  characters: "characters",
  "character-groups": "character-groups",
  personas: "personas",
  "persona-groups": "persona-groups",
  lorebooks: "lorebooks",
  "lorebook-entries": "lorebook-entries",
  prompts: "prompts",
  "prompt-sections": "prompt-sections",
  "prompt-groups": "prompt-groups",
  "prompt-variables": "prompt-variables",
};

const DEKI_PROMPT_CHILD_ORDER_FIELDS: Partial<
  Record<DekiActionEntity, "sectionOrder" | "groupOrder" | "variableOrder">
> = {
  "prompt-sections": "sectionOrder",
  "prompt-groups": "groupOrder",
  "prompt-variables": "variableOrder",
};

const DEKI_WORKSPACE_TOOL_NAMES = new Set<DekiWorkspaceToolName>([
  "read",
  "grep",
  "find",
  "ls",
  "deki_data",
  "deki_code",
  "read_deki_chats",
  "read_deki_chat_messages",
]);

const DEKI_WORKSPACE_HISTORY_STATUSES = new Set<DekiWorkspaceHistoryEntry["status"]>([
  "dry-run",
  "approved",
  "rejected",
  "cancelled",
  "timed_out",
  "blocked",
  "state_changed",
  "failed",
]);

const DEKI_WORKSPACE_HISTORY_CURRENT_KEYS = ["id", "sessionId", "command", "status", "validationStatus", "createdAt"];

const DEKI_WORKSPACE_UNAVAILABLE_REASON =
  "Deki workspace runtime requires the Tauri app shell or a configured remote runtime.";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizePreferences(value: unknown): DekiPreferences {
  const object = asRecord(value);
  const selectedConnectionId =
    typeof object.selectedConnectionId === "string" && object.selectedConnectionId.trim()
      ? object.selectedConnectionId
      : null;
  const selectedPersonaId =
    typeof object.selectedPersonaId === "string" && object.selectedPersonaId.trim() ? object.selectedPersonaId : null;
  return { selectedConnectionId, selectedPersonaId };
}

function normalizeDekiCompaction(value: unknown): DekiCompactionState {
  const object = asRecord(value);
  return {
    compactedSummary:
      typeof object.compactedSummary === "string" && object.compactedSummary.trim() ? object.compactedSummary : null,
    compactedAt: typeof object.compactedAt === "string" && object.compactedAt.trim() ? object.compactedAt : null,
    compactedThroughMessageId:
      typeof object.compactedThroughMessageId === "string" && object.compactedThroughMessageId.trim()
        ? object.compactedThroughMessageId
        : null,
  };
}

function normalizeDekiMessage(record: StoredMessageRecord): DekiMessage | null {
  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : null;
  const content = typeof record.content === "string" ? record.content : null;
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : null;
  if (!role || !id || content === null || !createdAt) return null;
  const action = role === "assistant" && "action" in record ? normalizeDekiEntryAction(record.action) : null;
  const workspaceTrace = normalizeDekiWorkspaceTrace(record.workspaceTrace);
  const workspaceHistory = normalizeDekiWorkspaceHistory(record.workspaceHistory);
  const message: DekiMessage = {
    id,
    role,
    content,
    createdAt,
  };
  if (action && action.type !== "none") {
    message.action = action;
    message.actionApplication = normalizeDekiActionApplication(record.actionApplication);
  }
  if (workspaceTrace) {
    message.workspaceTrace = workspaceTrace;
  }
  if (workspaceHistory) {
    message.workspaceHistory = workspaceHistory;
  }
  return message;
}

function normalizeDekiWorkspaceTrace(value: unknown): DekiWorkspaceTraceItem[] | null {
  if (!Array.isArray(value)) return null;
  const trace = value.map((item) => normalizeDekiWorkspaceTraceItem(item));
  return trace.length > 0 ? trace : null;
}

function normalizeDekiWorkspaceTraceItem(value: unknown): DekiWorkspaceTraceItem {
  const object = asRecord(value);
  if (
    (object.type === "text" || object.type === "thinking" || object.type === "status") &&
    typeof object.content === "string"
  ) {
    return { type: object.type, content: object.content };
  }
  if (object.type !== "tool") return unknownDekiWorkspaceTraceItem(value);
  const tool = asRecord(object.tool);
  const id = readTrimmedString(tool.id);
  const name = isDekiWorkspaceToolName(tool.name) ? tool.name : null;
  const status = tool.status === "running" || tool.status === "done" || tool.status === "error" ? tool.status : null;
  if (!id || !name || !status) return unknownDekiWorkspaceTraceItem(value);
  return {
    type: "tool",
    tool: {
      id,
      name,
      status,
      ...(tool.input !== undefined ? { input: tool.input } : {}),
      ...(typeof tool.output === "string" || tool.output === null ? { output: tool.output } : {}),
      ...(typeof tool.updatedAt === "number" && Number.isFinite(tool.updatedAt) ? { updatedAt: tool.updatedAt } : {}),
    },
  };
}

function unknownDekiWorkspaceTraceItem(value: unknown): DekiWorkspaceTraceItem {
  return { type: "unknown", raw: value };
}

function normalizeDekiWorkspaceHistory(value: unknown): DekiWorkspaceHistoryItem[] | null {
  if (!Array.isArray(value)) return null;
  const history = value
    .map((item) => normalizeDekiWorkspaceHistoryEntry(item))
    .filter((item): item is DekiWorkspaceHistoryItem => !!item);
  return history.length > 0 ? history : null;
}

function normalizeDekiWorkspaceHistoryEntry(value: unknown): DekiWorkspaceHistoryItem | null {
  const object = asRecord(value);
  if (Object.keys(object).length === 0) return null;
  const id = readTrimmedString(object.id);
  const sessionId = readTrimmedString(object.sessionId);
  const command = readTrimmedString(object.command);
  const status = isDekiWorkspaceHistoryStatus(object.status) ? object.status : null;
  const validationStatus =
    object.validationStatus === "passed" || object.validationStatus === "blocked" ? object.validationStatus : null;
  const createdAt = readTrimmedString(object.createdAt);

  if (!hasCurrentDekiWorkspaceHistoryKeys(object)) {
    return isPartialCurrentDekiWorkspaceHistory(object, { id, sessionId, command, createdAt })
      ? malformedDekiWorkspaceHistoryItem(value, "invalid current history required field")
      : unknownDekiWorkspaceHistoryItem(value);
  }

  if (!id || !sessionId || !command || !createdAt) {
    return malformedDekiWorkspaceHistoryItem(value, "invalid current history required field");
  }
  if (!status || !validationStatus) {
    return malformedDekiWorkspaceHistoryItem(value, "invalid current history status");
  }
  const operationHash = readTrimmedString(object.operationHash);
  const completedAt = readTrimmedString(object.completedAt);
  return {
    id,
    sessionId,
    command,
    reason: typeof object.reason === "string" && object.reason.trim() ? object.reason : null,
    status,
    ...(operationHash ? { operationHash } : {}),
    affectedEntities: normalizeDekiWorkspaceCountRecord(object.affectedEntities),
    affectedRows:
      typeof object.affectedRows === "number" && Number.isFinite(object.affectedRows) ? object.affectedRows : 0,
    validationStatus,
    journalPath: typeof object.journalPath === "string" && object.journalPath.trim() ? object.journalPath : null,
    createdAt,
    ...(completedAt ? { completedAt } : {}),
  };
}

function malformedDekiWorkspaceHistoryItem(value: unknown, reason: string): DekiWorkspaceHistoryItem {
  const object = asRecord(value);
  const id = readTrimmedString(object.id);
  const createdAt = readTrimmedString(object.createdAt);
  return {
    status: "malformed",
    reason,
    raw: value,
    ...(id ? { id } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function unknownDekiWorkspaceHistoryItem(value: unknown): DekiWorkspaceHistoryItem {
  const object = asRecord(value);
  const id = readTrimmedString(object.id);
  const createdAt = readTrimmedString(object.createdAt);
  return {
    status: "unknown",
    raw: value,
    ...(id ? { id } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function hasCurrentDekiWorkspaceHistoryKeys(object: Record<string, unknown>): boolean {
  return DEKI_WORKSPACE_HISTORY_CURRENT_KEYS.every((key) => key in object);
}

function isPartialCurrentDekiWorkspaceHistory(
  object: Record<string, unknown>,
  values: { id: string | null; sessionId: string | null; command: string | null; createdAt: string | null },
): boolean {
  if (!("status" in object) || !("validationStatus" in object)) return false;
  return !values.id || !values.sessionId || !values.command || !values.createdAt;
}

function normalizeDekiWorkspaceCountRecord(value: unknown): Record<string, number> {
  const object = asRecord(value);
  return Object.fromEntries(
    Object.entries(object).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function isDekiWorkspaceToolName(value: unknown): value is DekiWorkspaceToolName {
  return typeof value === "string" && DEKI_WORKSPACE_TOOL_NAMES.has(value as DekiWorkspaceToolName);
}

function isDekiWorkspaceHistoryStatus(value: unknown): value is DekiWorkspaceHistoryEntry["status"] {
  return typeof value === "string" && DEKI_WORKSPACE_HISTORY_STATUSES.has(value as DekiWorkspaceHistoryEntry["status"]);
}

function hasDekiWorkspaceRuntime(): boolean {
  return hasEmbeddedTauriIpc() || remoteRuntimeTarget() !== null;
}

function requireDekiWorkspaceRuntime(command: string): void {
  if (hasDekiWorkspaceRuntime()) return;
  throw new ApiError(DEKI_WORKSPACE_UNAVAILABLE_REASON, 400, {
    code: "deki_workspace_runtime_unavailable",
    command,
  });
}

function normalizeDekiActionApplication(value: unknown): DekiActionApplication | null {
  const object = asRecord(value);
  if (object.status !== "applied") return null;
  const appliedAt = typeof object.appliedAt === "string" && object.appliedAt.trim() ? object.appliedAt : null;
  if (!appliedAt) return null;
  return {
    status: "applied",
    appliedAt,
    resultId: typeof object.resultId === "string" && object.resultId.trim() ? object.resultId : null,
  };
}

function newId(prefix: string) {
  const nonce =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${nonce}`;
}

function createDekiMessage(message: {
  role: "user" | "assistant";
  content: string;
  action?: DekiEntryAction | null;
  workspaceTrace?: DekiWorkspaceTraceItem[];
  workspaceHistory?: DekiWorkspaceHistoryItem[];
}): DekiMessage {
  const next: DekiMessage = {
    id: newId("deki-message"),
    role: message.role,
    content: message.content,
    createdAt: new Date().toISOString(),
  };
  if (message.role === "assistant" && message.action && message.action.type !== "none") {
    next.action = message.action;
  }
  if (message.workspaceTrace?.length) {
    next.workspaceTrace = message.workspaceTrace;
  }
  if (message.workspaceHistory?.length) {
    next.workspaceHistory = message.workspaceHistory;
  }
  return next;
}

function normalizeDekiMessages(value: unknown): DekiMessage[] {
  const object = asRecord(value);
  const rawMessages = Array.isArray(object.messages) ? object.messages : [];
  return rawMessages
    .map((message) => normalizeDekiMessage(asRecord(message) as StoredMessageRecord))
    .filter((message): message is DekiMessage => !!message);
}

function createEmptyDekiSession(): DekiSession {
  return createDekiSession({ id: newId("deki-session") });
}

function titleFromMessages(messages: DekiMessage[]): string {
  const firstUserMessage = messages
    .find((message) => message.role === "user")
    ?.content.trim()
    .replace(/\s+/g, " ");
  if (!firstUserMessage) return "New Deki Chat";
  return firstUserMessage.length > 48 ? `${firstUserMessage.slice(0, 45)}...` : firstUserMessage;
}

function normalizeDekiSession(value: unknown): DekiSession | null {
  const object = asRecord(value);
  const id = typeof object.id === "string" && object.id.trim() ? object.id : null;
  if (!id) return null;
  const messages = normalizeDekiMessages(object);
  const createdAt =
    typeof object.createdAt === "string" && object.createdAt.trim()
      ? object.createdAt
      : (messages[0]?.createdAt ?? new Date().toISOString());
  const updatedAt =
    typeof object.updatedAt === "string" && object.updatedAt.trim()
      ? object.updatedAt
      : (messages.at(-1)?.createdAt ?? createdAt);
  const title = typeof object.title === "string" && object.title.trim() ? object.title : titleFromMessages(messages);
  return {
    id,
    title,
    messages,
    compaction: normalizeDekiCompaction(object.compaction ?? object),
    createdAt,
    updatedAt,
  };
}

function normalizeDekiSessionsState(settings: unknown): DekiSessionsState {
  const object = asRecord(settings);
  const seen = new Set<string>();
  const sessions = (Array.isArray(object.sessions) ? object.sessions : [])
    .map(normalizeDekiSession)
    .filter((session): session is DekiSession => {
      if (!session || seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });

  if (sessions.length === 0) {
    const legacyMessages = normalizeDekiMessages(object);
    sessions.push(
      createDekiSession({
        id: LEGACY_DEKI_SESSION_ID,
        title: titleFromMessages(legacyMessages),
        messages: legacyMessages,
        compaction: normalizeDekiCompaction(object),
        now: legacyMessages[0]?.createdAt ?? new Date().toISOString(),
      }),
    );
  }

  const requestedActiveId = typeof object.activeSessionId === "string" ? object.activeSessionId : null;
  const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
    ? requestedActiveId!
    : sessions[0]!.id;

  return { activeSessionId, sessions };
}

async function readSettingsRecord(): Promise<DekiSettingsRecord | null> {
  const record = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  if (record) return record;
  return storageApi.get<DekiSettingsRecord>("app-settings", LEGACY_DEKI_SETTINGS_ID);
}

async function readSettingsValue(): Promise<Record<string, unknown>> {
  const record = await readSettingsRecord();
  const parsed = appSettingsResponseSchema.safeParse(record ?? { value: null });
  return asRecord(parsed.success ? parsed.data.value : null);
}

async function saveSettingsPatch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const existing = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  const legacy = existing ? null : await storageApi.get<DekiSettingsRecord>("app-settings", LEGACY_DEKI_SETTINGS_ID);
  const source = existing ?? legacy;
  const parsed = appSettingsResponseSchema.safeParse(source ?? { value: null });
  const value = {
    ...asRecord(parsed.success ? parsed.data.value : null),
    ...patch,
  };
  const payload = appSettingsUpdateSchema.parse({ value });
  if (existing) {
    await storageApi.update("app-settings", DEKI_SETTINGS_ID, payload);
  } else {
    await storageApi.create("app-settings", {
      id: DEKI_SETTINGS_ID,
      ...payload,
    });
  }
  if (!existing && legacy) {
    await storageApi.delete("app-settings", LEGACY_DEKI_SETTINGS_ID);
  }
  return value;
}

async function saveSettingsTransform(
  transform: (settings: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  const legacy = existing ? null : await storageApi.get<DekiSettingsRecord>("app-settings", LEGACY_DEKI_SETTINGS_ID);
  const source = existing ?? legacy;
  const parsed = appSettingsResponseSchema.safeParse(source ?? { value: null });
  const value = transform(asRecord(parsed.success ? parsed.data.value : null));
  const payload = appSettingsUpdateSchema.parse({ value });
  if (existing) {
    await storageApi.update("app-settings", DEKI_SETTINGS_ID, payload);
  } else {
    await storageApi.create("app-settings", {
      id: DEKI_SETTINGS_ID,
      ...payload,
    });
  }
  if (!existing && legacy) {
    await storageApi.delete("app-settings", LEGACY_DEKI_SETTINGS_ID);
  }
  return value;
}

function normalizeDekiSessionRecord(record: DekiSessionRecord, messages: DekiMessage[]): DekiSession | null {
  const id = typeof record.id === "string" && record.id.trim() ? record.id : null;
  if (!id) return null;
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt
      : (messages[0]?.createdAt ?? new Date().toISOString());
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : (messages.at(-1)?.createdAt ?? createdAt);
  const title = typeof record.title === "string" && record.title.trim() ? record.title : titleFromMessages(messages);
  return {
    id,
    title,
    messages,
    compaction: normalizeDekiCompaction(record.compaction),
    createdAt,
    updatedAt,
  };
}

function dekiMessageRecord(sessionId: string, message: DekiMessage, index: number): Record<string, unknown> {
  const action = message.action && message.action.type !== "none" ? message.action : null;
  return {
    id: message.id,
    sessionId,
    role: message.role,
    content: message.content,
    createdAt: readTrimmedString(message.createdAt) ?? new Date().toISOString(),
    sortOrder: index,
    ...(action ? { action, actionApplication: message.actionApplication ?? null } : {}),
    ...(message.workspaceTrace ? { workspaceTrace: message.workspaceTrace } : {}),
    ...(message.workspaceHistory ? { workspaceHistory: message.workspaceHistory } : {}),
  };
}

function dekiSessionRecord(session: DekiSession): Record<string, unknown> {
  const createdAt = readTrimmedString(session.createdAt) ?? new Date().toISOString();
  const updatedAt = readTrimmedString(session.updatedAt) ?? createdAt;
  return {
    id: session.id,
    title: readTrimmedString(session.title) ?? titleFromMessages(session.messages),
    compaction: normalizeDekiCompaction(session.compaction),
    createdAt,
    updatedAt,
  };
}

function dekiHistoryPersistenceSnapshot(state: DekiSessionsState): DekiHistoryPersistenceSnapshot {
  return {
    activeSessionId: state.activeSessionId,
    records: state.sessions.flatMap((session) => [
      {
        entity: "deki-sessions" as const,
        id: session.id,
        value: dekiSessionRecord(session),
      },
      ...session.messages.map((message, index) => ({
        entity: "deki-messages" as const,
        id: message.id,
        value: dekiMessageRecord(session.id, message, index),
      })),
    ]),
  };
}

async function writeStorageRecord(
  entity: "deki-sessions" | "deki-messages",
  id: string,
  value: Record<string, unknown>,
): Promise<void> {
  const existing = await storageApi.get(entity, id).catch(() => null);
  if (existing) await storageApi.update(entity, id, value);
  else await storageApi.create(entity, value);
}

async function readDurableSessionsState(hydrateSessionId?: string | null): Promise<DekiSessionsState | null> {
  const records = await measureDekiStage(
    "deki.session_summaries",
    () =>
      storageApi.list<DekiSessionRecord>("deki-sessions", {
        orderBy: "updatedAt",
        descending: true,
      }),
    (sessions) => ({ sessionCount: sessions.length }),
  );
  if (records.length === 0) return null;

  const settings = await readSettingsValue();
  const summarySessionIds = records.map((record) => readTrimmedString(record.id)).filter((id): id is string => !!id);
  const requestedActiveId = typeof settings.activeSessionId === "string" ? settings.activeSessionId : null;
  const activeSessionId = summarySessionIds.includes(requestedActiveId ?? "")
    ? requestedActiveId!
    : (summarySessionIds[0] ?? null);
  const messageSessionId =
    hydrateSessionId === null
      ? null
      : summarySessionIds.includes(hydrateSessionId ?? "")
        ? hydrateSessionId!
        : activeSessionId;
  const sessions: DekiSession[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const sessionId = readTrimmedString(record.id);
    if (!sessionId || seen.has(sessionId)) continue;
    const readMessages = () =>
      storageApi.list<DekiMessageRecord>("deki-messages", {
        filters: { sessionId },
        orderBy: "sortOrder",
      });
    const messageRecords =
      sessionId === messageSessionId
        ? await measureDekiStage("deki.active_history", readMessages, (messages) => ({ messageCount: messages.length }))
        : hydrateSessionId === undefined
          ? await readMessages()
          : [];
    const messages = messageRecords
      .map((message) => normalizeDekiMessage(message))
      .filter((message): message is DekiMessage => !!message);
    const session = normalizeDekiSessionRecord({ ...record, id: sessionId }, messages);
    if (session) {
      seen.add(session.id);
      sessions.push(session);
    }
  }
  if (sessions.length === 0) return null;

  const resolvedActiveSessionId = sessions.some((session) => session.id === activeSessionId)
    ? activeSessionId!
    : sessions[0]!.id;
  return { activeSessionId: resolvedActiveSessionId, sessions };
}

async function saveDurableSessionsState(state: DekiSessionsState): Promise<DekiSessionsState> {
  const normalized = normalizeDekiSessionsState({ activeSessionId: state.activeSessionId, sessions: state.sessions });
  const sessionIds = new Set(normalized.sessions.map((session) => session.id));
  const messageIds = new Set<string>();

  for (const session of normalized.sessions) {
    await writeStorageRecord("deki-sessions", session.id, dekiSessionRecord(session));
    for (let index = 0; index < session.messages.length; index += 1) {
      const message = session.messages[index]!;
      messageIds.add(message.id);
      await writeStorageRecord("deki-messages", message.id, dekiMessageRecord(session.id, message, index));
    }
  }

  const existingSessions = await storageApi.list<DekiSessionRecord>("deki-sessions");
  await Promise.all(
    existingSessions
      .filter((record) => typeof record.id === "string" && !sessionIds.has(record.id))
      .map((record) => storageApi.delete("deki-sessions", record.id)),
  );

  const existingMessages = await storageApi.list<DekiMessageRecord>("deki-messages");
  await Promise.all(
    existingMessages.flatMap((record) => {
      const id = typeof record.id === "string" ? record.id : "";
      return id && !messageIds.has(id) ? [storageApi.delete("deki-messages", id)] : [];
    }),
  );

  await saveSettingsPatch({ activeSessionId: normalized.activeSessionId });
  return normalized;
}

async function saveIncrementalSessionsState(
  previousState: DekiSessionsState,
  nextState: DekiSessionsState,
): Promise<DekiSessionsState> {
  const previous = normalizeDekiSessionsState(previousState);
  const next = normalizeDekiSessionsState(nextState);
  const plan = planDekiHistoryPersistence(
    dekiHistoryPersistenceSnapshot(previous),
    dekiHistoryPersistenceSnapshot(next),
  );

  for (const record of plan.creates) {
    await storageApi.create(record.entity, record.value);
  }
  for (const record of plan.updates) {
    await storageApi.update(record.entity, record.id, record.value);
  }
  for (const record of plan.deletes) {
    await storageApi.delete(record.entity, record.id);
  }
  await saveSettingsPatch({ activeSessionId: next.activeSessionId });
  return next;
}

async function clearLegacyDekiHistorySettings(activeSessionId: string): Promise<void> {
  await saveSettingsTransform((settings) => {
    const {
      sessions: _sessions,
      messages: _messages,
      compaction: _compaction,
      compactedSummary: _compactedSummary,
      compactedAt: _compactedAt,
      compactedThroughMessageId: _compactedThroughMessageId,
      ...rest
    } = settings;
    return { ...rest, activeSessionId };
  });
}

async function readSessionsState(hydrateSessionId?: string | null): Promise<DekiSessionsState> {
  const durable = await readDurableSessionsState(hydrateSessionId);
  if (durable) return durable;

  const legacy = normalizeDekiSessionsState(await readSettingsValue());
  await saveDurableSessionsState(legacy);
  await clearLegacyDekiHistorySettings(legacy.activeSessionId);
  return legacy;
}

async function saveSessionsState(
  previousState: DekiSessionsState,
  nextState: DekiSessionsState,
): Promise<DekiSessionsState> {
  return saveIncrementalSessionsState(previousState, nextState);
}
function updateSession(
  state: DekiSessionsState,
  sessionId: string | null | undefined,
  update: (session: DekiSession) => DekiSession,
): DekiSessionsState {
  const session = sessionId ? state.sessions.find((item) => item.id === sessionId) : getActiveDekiSession(state);
  const target = session ?? getActiveDekiSession(state);
  return {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map((item) => (item.id === target.id ? update(target) : item)),
  };
}

function sessionFromState(state: DekiSessionsState, sessionId: string | null | undefined): DekiSession {
  return sessionId
    ? (state.sessions.find((item) => item.id === sessionId) ?? getActiveDekiSession(state))
    : getActiveDekiSession(state);
}

function historySnapshot(state: DekiSessionsState, sessionId: string | null | undefined): DekiHistorySnapshot {
  const session = sessionFromState(state, sessionId);
  return {
    session,
    messages: session.messages,
    compaction: session.compaction,
  };
}

function compactionForMessages(messages: DekiMessage[], compaction: DekiCompactionState): DekiCompactionState {
  const throughMessageId = compaction.compactedThroughMessageId;
  if (!throughMessageId || messages.some((message) => message.id === throughMessageId)) return compaction;
  return {
    compactedSummary: null,
    compactedAt: null,
    compactedThroughMessageId: null,
  };
}

function storageEntityForDekiAction(entity: DekiActionEntity): StorageEntity {
  return DEKI_ACTION_STORAGE_ENTITIES[entity];
}

function recordId(record: unknown): string | null {
  const object = asRecord(record);
  return typeof object.id === "string" && object.id.trim() ? object.id : null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseOrderIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

async function waitForDekiStorageRetry(attempt: number): Promise<void> {
  if (attempt === 0) return;
  await new Promise((resolve) => setTimeout(resolve, attempt * 25));
}

function sanitizeDekiActionId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return sanitized || "action";
}

function createActionRecordId(entity: DekiActionEntity, actionId: string | undefined): string | null {
  if (!actionId?.trim()) return null;
  return `deki-${sanitizeDekiActionId(entity)}-${sanitizeDekiActionId(actionId)}`;
}

function withCreateActionId(
  entity: DekiActionEntity,
  draft: Record<string, unknown>,
  actionId: string | undefined,
): { draft: Record<string, unknown>; idempotencyId: string | null } {
  const existingId = readTrimmedString(draft.id);
  if (existingId) return { draft: { ...draft, id: existingId }, idempotencyId: existingId };
  const generatedId = createActionRecordId(entity, actionId);
  return generatedId
    ? { draft: { ...draft, id: generatedId }, idempotencyId: generatedId }
    : { draft, idempotencyId: null };
}

function assertDekiRecordActionPayload(
  action: Extract<DekiEntryAction, { type: "create_record" | "edit_record" }>,
  requireCompleteCard: boolean,
): void {
  const payload = action.type === "create_record" ? action.draft : action.patch;
  const error = validateDekiRecordActionPayload(action.entity, payload, { requireCompleteCard });
  if (error) throw new Error(`Deki-senpai ${action.entity} action is invalid: ${error}`);
}
function normalizeCreateActionDraft(
  action: Extract<DekiEntryAction, { type: "create_record" }>,
  actionId: string | undefined,
): { draft: Record<string, unknown>; idempotencyId: string | null } {
  switch (action.entity) {
    case "characters":
      assertDekiRecordActionPayload(action, true);
      return withCreateActionId(action.entity, createCharacterSchema.parse(action.draft), actionId);
    case "personas":
      assertDekiRecordActionPayload(action, true);
      return withCreateActionId(action.entity, action.draft, actionId);
    case "prompt-sections":
      return withCreateActionId(action.entity, createPromptSectionSchema.parse(action.draft), actionId);
    case "prompt-groups":
      return withCreateActionId(action.entity, createPromptGroupSchema.parse(action.draft), actionId);
    case "prompt-variables":
      return withCreateActionId(action.entity, createChoiceBlockSchema.parse(action.draft), actionId);
    default:
      return withCreateActionId(action.entity, action.draft, actionId);
  }
}

async function getExistingDekiActionRecord(
  storageEntity: StorageEntity,
  idempotencyId: string | null,
): Promise<unknown | null> {
  if (!idempotencyId) return null;
  return storageApi.get(storageEntity, idempotencyId).catch(() => null);
}

async function createDekiActionRecord(
  storageEntity: StorageEntity,
  draft: Record<string, unknown>,
  idempotencyId: string | null,
): Promise<unknown> {
  const existing = await getExistingDekiActionRecord(storageEntity, idempotencyId);
  if (existing) return existing;
  try {
    return await storageApi.create(storageEntity, draft);
  } catch (error) {
    const recovered = await getExistingDekiActionRecord(storageEntity, idempotencyId);
    if (recovered) return recovered;
    throw error;
  }
}

async function appendPromptChildToParentOrder(
  entity: DekiActionEntity,
  draft: Record<string, unknown>,
  created: unknown,
): Promise<void> {
  const orderField = DEKI_PROMPT_CHILD_ORDER_FIELDS[entity];
  if (!orderField) return;
  const createdRecord = asRecord(created);
  const presetId = readTrimmedString(draft.presetId) ?? readTrimmedString(createdRecord.presetId);
  const childId = recordId(created) ?? readTrimmedString(draft.id);
  if (!presetId) throw new Error(`${entity} actions require a presetId.`);
  if (!childId) throw new Error(`${entity} actions must return a created record id.`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForDekiStorageRetry(attempt);
    const preset = await storageApi.get<Record<string, unknown>>("prompts", presetId);
    if (!preset) throw new Error(`Prompt preset ${presetId} was not found.`);
    const currentOrder = parseOrderIds(preset[orderField]);
    if (currentOrder.includes(childId)) return;
    await storageApi.update(
      "prompts",
      presetId,
      updatePromptPresetSchema.parse({
        [orderField]: [...currentOrder, childId],
      }),
    );
    const refreshed = await storageApi.get<Record<string, unknown>>("prompts", presetId).catch(() => null);
    if (parseOrderIds(refreshed?.[orderField]).includes(childId)) return;
  }
  throw new Error(`${entity} action could not reconcile ${orderField} for prompt preset ${presetId}.`);
}

async function applyEditDekiAction(
  action: Extract<DekiEntryAction, { type: "edit_record" }>,
  storageEntity: StorageEntity,
): Promise<unknown> {
  assertDekiRecordActionPayload(action, false);
  return storageApi.update(storageEntity, action.id, action.patch);
}
async function applyCreateDekiAction(
  action: Extract<DekiEntryAction, { type: "create_record" }>,
  actionId: string | undefined,
): Promise<unknown> {
  const storageEntity = storageEntityForDekiAction(action.entity);
  const { draft, idempotencyId } = normalizeCreateActionDraft(action, actionId);
  const result = await createDekiActionRecord(storageEntity, draft, idempotencyId);
  await appendPromptChildToParentOrder(action.entity, draft, result);
  return result;
}

type DekiLorebookScopeMode = "all" | "disabled" | "specific";

function normalizeDekiLorebookScope(value: unknown): { mode: DekiLorebookScopeMode; chatIds: string[] } {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      raw = trimmed ? JSON.parse(trimmed) : null;
    } catch {
      raw = trimmed.toLowerCase();
    }
  }
  const object = asRecord(raw);
  const rawMode = typeof raw === "string" ? raw : object.mode;
  const mode: DekiLorebookScopeMode =
    rawMode === "disabled" || rawMode === "specific" || rawMode === "all" ? rawMode : "all";
  const chatIds =
    mode === "specific" && Array.isArray(object.chatIds)
      ? Array.from(
          new Set(
            object.chatIds
              .filter((id): id is string => typeof id === "string")
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        )
      : [];
  return { mode, chatIds };
}

function normalizeDekiLorebookPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!("scope" in payload)) return payload;
  return {
    ...payload,
    scope: normalizeDekiLorebookScope(payload.scope),
  };
}

function stripRecordId(record: Record<string, unknown>): { id: string | null; payload: Record<string, unknown> } {
  const { id: rawId, ...payload } = record;
  return { id: readTrimmedString(rawId), payload };
}

async function applyLorebookRedraftEntry(
  lorebookId: string,
  entry: Record<string, unknown>,
  index: number,
  actionId: string | undefined,
): Promise<unknown> {
  const { id: entryId, payload } = stripRecordId(entry);
  if (entryId) {
    return storageApi.update(
      "lorebook-entries",
      entryId,
      updateLorebookEntrySchema.parse({
        ...payload,
        lorebookId,
      }),
    );
  }

  const generatedId = createActionRecordId("lorebook-entries", actionId ? `${actionId}-${index + 1}` : undefined);
  const parsed = createLorebookEntrySchema.parse({
    ...payload,
    lorebookId,
  });
  const draft = generatedId ? { id: generatedId, ...parsed } : parsed;
  return createDekiActionRecord("lorebook-entries", draft, generatedId);
}

async function applyLorebookRedraftAction(
  action: Extract<DekiEntryAction, { type: "apply_lorebook_redraft" }>,
  actionId: string | undefined,
): Promise<{ lorebook: unknown; entries: unknown[] }> {
  const { id: lorebookPayloadId, payload: rawLorebookPayload } = stripRecordId(action.lorebook);
  const lorebookPayload = normalizeDekiLorebookPayload(rawLorebookPayload);
  const requestedLorebookId = readTrimmedString(action.id) ?? lorebookPayloadId;
  const generatedLorebookId = createActionRecordId("lorebooks", actionId);
  const lorebook = requestedLorebookId
    ? await storageApi.update("lorebooks", requestedLorebookId, updateLorebookSchema.parse(lorebookPayload))
    : await createDekiActionRecord(
        "lorebooks",
        generatedLorebookId
          ? { id: generatedLorebookId, ...createLorebookSchema.parse(lorebookPayload) }
          : createLorebookSchema.parse(lorebookPayload),
        generatedLorebookId,
      );
  const lorebookId = recordId(lorebook) ?? requestedLorebookId;
  if (!lorebookId) throw new Error("Deki-senpai lorebook redraft did not produce a lorebook id.");

  const entries = [];
  for (let index = 0; index < action.entries.length; index += 1) {
    entries.push(await applyLorebookRedraftEntry(lorebookId, action.entries[index]!, index, actionId));
  }
  return { lorebook, entries };
}

function dekiActionResultId(action: DekiEntryAction, result: unknown): string | null {
  if (action.type === "apply_lorebook_redraft") {
    return recordId(asRecord(result).lorebook);
  }
  return recordId(result);
}
async function markDekiActionApplied(
  messageId: string,
  application: DekiActionApplication,
  sessionId?: string | null,
): Promise<DekiActionApplication> {
  const status = await writeDekiActionApplication(sessionId, messageId, application);
  return status.application;
}

async function writeDekiActionApplication(
  sessionId: string | null | undefined,
  messageId: string,
  application: DekiActionApplication,
): Promise<{
  application: DekiActionApplication;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
}> {
  const state = await readSessionsState();
  let savedApplication: DekiActionApplication | null = null;
  const nextState = updateSession(state, sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === messageId && message.action && message.action.type !== "none"
        ? (() => {
            savedApplication =
              message.actionApplication?.status === "applied" ? message.actionApplication : application;
            return { ...message, actionApplication: savedApplication };
          })()
        : message,
    ),
  }));
  if (!savedApplication) {
    throw new Error("Deki-senpai action message was not found.");
  }
  const saved = await saveSessionsState(state, nextState);
  const session = sessionFromState(saved, sessionId);
  return {
    application: savedApplication,
    messages: session.messages,
    compaction: session.compaction,
  };
}

export const dekiApi = {
  prompt: (request: DekiEntryRequest) =>
    invokeTauri<DekiGatewayResponse>("deki_prompt", {
      request,
    }),
  workspace: {
    status: async (connectionId?: string | null): Promise<DekiWorkspaceStatus> => {
      requireDekiWorkspaceRuntime("deki_workspace_status");
      return invokeTauri<DekiWorkspaceStatus>("deki_workspace_status", {
        connectionId: connectionId ?? null,
      });
    },
    abort: async (): Promise<DekiWorkspaceAbortResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_abort");
      return invokeTauri<DekiWorkspaceAbortResult>("deki_workspace_abort");
    },
    approve: async (id: string): Promise<DekiWorkspaceApprovalDecisionResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_approve");
      return invokeTauri<DekiWorkspaceApprovalDecisionResult>("deki_workspace_approve", { id });
    },
    reject: async (id: string): Promise<DekiWorkspaceApprovalDecisionResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_reject");
      return invokeTauri<DekiWorkspaceApprovalDecisionResult>("deki_workspace_reject", { id });
    },
  },
  actions: {
    currentRecord: async (action: DekiEntryAction): Promise<DekiActionCurrentRecordResult | null> => {
      if (action.type !== "edit_record") return null;
      const storageEntity = storageEntityForDekiAction(action.entity);
      const record = await storageApi.get<Record<string, unknown>>(storageEntity, action.id);
      return {
        entity: action.entity,
        storageEntity,
        id: action.id,
        record,
      };
    },
    apply: async (
      action: DekiEntryAction,
      options?: { actionId?: string; messageId?: string; sessionId?: string | null },
    ): Promise<DekiActionApplyResult> => {
      if (action.type === "none" || action.type === "request_chat_access" || action.type === "request_web_research") {
        throw new Error("Deki-senpai did not provide an applyable action.");
      }
      const storageEntity =
        action.type === "apply_lorebook_redraft" ? "lorebooks" : storageEntityForDekiAction(action.entity);
      const result =
        action.type === "apply_lorebook_redraft"
          ? await applyLorebookRedraftAction(action, options?.actionId)
          : action.type === "create_record"
            ? await applyCreateDekiAction(action, options?.actionId)
            : await applyEditDekiAction(action, storageEntity);
      const resultId = dekiActionResultId(action, result);
      const appliedStatus = options?.messageId
        ? await writeDekiActionApplication(options.sessionId, options.messageId, {
            status: "applied",
            appliedAt: new Date().toISOString(),
            resultId,
          })
        : null;
      return {
        entity: action.type === "apply_lorebook_redraft" ? "lorebooks" : action.entity,
        storageEntity,
        result,
        resultId,
        application: appliedStatus?.application ?? null,
        messages: appliedStatus?.messages ?? null,
        compaction: appliedStatus?.compaction ?? null,
      };
    },
  },
  preferences: {
    get: async (): Promise<DekiPreferences> => {
      return normalizePreferences(await readSettingsValue());
    },
    save: async (preferences: DekiPreferences): Promise<DekiPreferences> => {
      return normalizePreferences(
        await saveSettingsPatch({
          selectedConnectionId: preferences.selectedConnectionId,
          selectedPersonaId: preferences.selectedPersonaId,
        }),
      );
    },
  },
  sessions: {
    list: async (): Promise<DekiSessionsState> => readSessionsState(null),
    create: async (): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState(state, { activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
    select: async (sessionId: string): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const nextActiveSessionId = state.sessions.some((session) => session.id === sessionId)
        ? sessionId
        : state.activeSessionId;
      return saveSessionsState(state, { ...state, activeSessionId: nextActiveSessionId });
    },
    delete: async (sessionId: string): Promise<DekiSessionsState> => {
      return dekiApi.sessions.deleteMany([sessionId]);
    },
    deleteMany: async (sessionIds: readonly string[]): Promise<DekiSessionsState> => {
      const ids = new Set(sessionIds.map((id) => id.trim()).filter(Boolean));
      const state = await readSessionsState();
      if (ids.size === 0) return state;

      const remaining = state.sessions.filter((session) => !ids.has(session.id));
      if (remaining.length === state.sessions.length) return state;
      if (remaining.length === 0) {
        const session = createEmptyDekiSession();
        return saveSessionsState(state, { activeSessionId: session.id, sessions: [session] });
      }
      const activeSessionId = ids.has(state.activeSessionId) ? remaining[0]!.id : state.activeSessionId;
      return saveSessionsState(state, { activeSessionId, sessions: remaining });
    },
  },
  history: {
    get: async (sessionId?: string | null): Promise<DekiHistorySnapshot> => {
      return historySnapshot(await readSessionsState(sessionId ?? ""), sessionId);
    },
    appendMessage: async (message: {
      sessionId?: string | null;
      role: "user" | "assistant";
      content: string;
      action?: DekiEntryAction | null;
      workspaceTrace?: DekiWorkspaceTraceItem[];
      workspaceHistory?: DekiWorkspaceHistoryItem[];
    }): Promise<DekiMessage> => {
      const state = await readSessionsState(message.sessionId ?? "");
      const nextMessage = createDekiMessage(message);
      const nextState = updateSession(state, message.sessionId, (session) => {
        const messages = [...session.messages, nextMessage];
        const isDefaultTitle = session.title === "New Deki Chat";
        return {
          ...session,
          title: message.role === "user" && isDefaultTitle ? titleFromMessages(messages) : session.title,
          messages,
          updatedAt: nextMessage.createdAt,
        };
      });
      await saveSessionsState(state, nextState);
      return nextMessage;
    },
    replaceMessages: async ({
      sessionId,
      messages,
      compaction,
    }: {
      sessionId?: string | null;
      messages: DekiMessage[];
      compaction: DekiCompactionState;
    }): Promise<DekiHistorySnapshot> => {
      const state = await readSessionsState();
      const nextCompaction = compactionForMessages(messages, compaction);
      const nextState = updateSession(state, sessionId, (session) => ({
        ...session,
        title: titleFromMessages(messages),
        messages,
        compaction: nextCompaction,
        updatedAt: messages.at(-1)?.createdAt ?? new Date().toISOString(),
      }));
      return historySnapshot(await saveSessionsState(state, nextState), sessionId);
    },
    updateMessage: async ({
      sessionId,
      messageId,
      content,
    }: {
      sessionId?: string | null;
      messageId: string;
      content: string;
    }): Promise<DekiMessage> => {
      const state = await readSessionsState();
      let updatedMessage: DekiMessage | null = null;
      const nextState = updateSession(state, sessionId, (session) => {
        const messages = session.messages.map((message) => {
          if (message.id !== messageId) return message;
          updatedMessage = { ...message, content };
          return updatedMessage;
        });
        return {
          ...session,
          title: titleFromMessages(messages),
          messages,
          updatedAt: updatedMessage?.createdAt ?? session.updatedAt,
        };
      });
      if (!updatedMessage) throw new Error("Deki-senpai message could not be found.");
      await saveSessionsState(state, nextState);
      return updatedMessage;
    },
    markActionApplied: markDekiActionApplied,
    saveCompaction: async (
      sessionId: string | null | undefined,
      compaction: DekiCompactionState,
    ): Promise<DekiCompactionState> => {
      const state = await readSessionsState();
      const nextState = updateSession(state, sessionId, (session) => ({ ...session, compaction }));
      const saved = await saveSessionsState(state, nextState);
      return sessionFromState(saved, sessionId).compaction;
    },
    reset: async (_sessionId?: string | null): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState(state, { activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
  },
};

export type { DekiChatAccessGrant };
