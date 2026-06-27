import {
  normalizeDekiEntryAction,
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
import {
  createChoiceBlockSchema,
  createPromptGroupSchema,
  createPromptSectionSchema,
  updatePromptPresetSchema,
} from "../../engine/contracts/schemas/prompt.schema";
import type { StorageEntity } from "../../engine/capabilities/storage";
import { ApiError } from "./api-errors";
import { remoteRuntimeTarget } from "./remote-runtime";
import { storageApi } from "./storage-api";
import { hasEmbeddedTauriIpc, invokeTauri } from "./tauri-client";

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

type DekiHistorySnapshot = {
  session: DekiSession;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
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

async function readSessionsState(): Promise<DekiSessionsState> {
  return normalizeDekiSessionsState(await readSettingsValue());
}

async function saveSessionsState(state: DekiSessionsState): Promise<DekiSessionsState> {
  return normalizeDekiSessionsState(
    await saveSettingsTransform((settings) => {
      const { messages: _messages, ...rest } = settings;
      return {
        ...rest,
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
      };
    }),
  );
}

function updateSession(
  state: DekiSessionsState,
  sessionId: string | null | undefined,
  update: (session: DekiSession) => DekiSession,
): DekiSessionsState {
  const session = sessionId ? state.sessions.find((item) => item.id === sessionId) : getActiveDekiSession(state);
  const target = session ?? getActiveDekiSession(state);
  return {
    activeSessionId: target.id,
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

function normalizeCreateActionDraft(
  action: Extract<DekiEntryAction, { type: "create_record" }>,
  actionId: string | undefined,
): { draft: Record<string, unknown>; idempotencyId: string | null } {
  switch (action.entity) {
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
  const saved = await saveSessionsState(nextState);
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
      if (action.type === "none" || action.type === "request_chat_access") {
        throw new Error("Deki-senpai did not provide an applyable action.");
      }
      const storageEntity = storageEntityForDekiAction(action.entity);
      const result =
        action.type === "create_record"
          ? await applyCreateDekiAction(action, options?.actionId)
          : await storageApi.update(storageEntity, action.id, action.patch);
      const resultId = recordId(result);
      const appliedStatus = options?.messageId
        ? await writeDekiActionApplication(options.sessionId, options.messageId, {
            status: "applied",
            appliedAt: new Date().toISOString(),
            resultId,
          })
        : null;
      return {
        entity: action.entity,
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
    list: readSessionsState,
    create: async (): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState({ activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
    select: async (sessionId: string): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const nextActiveSessionId = state.sessions.some((session) => session.id === sessionId)
        ? sessionId
        : state.activeSessionId;
      return saveSessionsState({ ...state, activeSessionId: nextActiveSessionId });
    },
    delete: async (sessionId: string): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const remaining = state.sessions.filter((session) => session.id !== sessionId);
      if (remaining.length === 0) {
        const session = createEmptyDekiSession();
        return saveSessionsState({ activeSessionId: session.id, sessions: [session] });
      }
      const activeSessionId = state.activeSessionId === sessionId ? remaining[0]!.id : state.activeSessionId;
      return saveSessionsState({ activeSessionId, sessions: remaining });
    },
  },
  history: {
    get: async (sessionId?: string | null): Promise<DekiHistorySnapshot> => {
      return historySnapshot(await readSessionsState(), sessionId);
    },
    appendMessage: async (message: {
      sessionId?: string | null;
      role: "user" | "assistant";
      content: string;
      action?: DekiEntryAction | null;
      workspaceTrace?: DekiWorkspaceTraceItem[];
      workspaceHistory?: DekiWorkspaceHistoryItem[];
    }): Promise<DekiMessage> => {
      const state = await readSessionsState();
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
      await saveSessionsState(nextState);
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
      return historySnapshot(await saveSessionsState(nextState), sessionId);
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
      await saveSessionsState(nextState);
      return updatedMessage;
    },
    markActionApplied: markDekiActionApplied,
    saveCompaction: async (
      sessionId: string | null | undefined,
      compaction: DekiCompactionState,
    ): Promise<DekiCompactionState> => {
      const state = await readSessionsState();
      const nextState = updateSession(state, sessionId, (session) => ({ ...session, compaction }));
      const saved = await saveSessionsState(nextState);
      return sessionFromState(saved, sessionId).compaction;
    },
    reset: async (_sessionId?: string | null): Promise<DekiSessionsState> => {
      const state = await readSessionsState();
      const session = createEmptyDekiSession();
      return saveSessionsState({ activeSessionId: session.id, sessions: [session, ...state.sessions] });
    },
  },
};

export type { DekiChatAccessGrant };
