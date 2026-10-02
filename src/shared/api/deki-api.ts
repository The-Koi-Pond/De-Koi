import {
  normalizeDekiEntryAction,
  validateDekiRecordActionPayload,
  type DekiActionApplication,
  type DekiActionEntity,
  type DekiEntryAction,
  type DekiEntryRequest,
  type DekiGatewayResponse,
  type DekiWorkspaceAbortResult,
  type DekiWorkspaceApprovalDecisionResult,
  type DekiWorkspaceHistoryEntry,
  type DekiWorkspaceHistoryItem,
  type DekiWorkspacePendingApproval,
  type DekiWorkspacePromptEvent,
  type DekiWorkspaceRowChange,
  type DekiWorkspaceStatus,
  type DekiWorkspaceToolName,
  type DekiWorkspaceTraceItem,
  type DekiMessage,
} from "../../engine/deki/deki-entry";
import {
  createDekiSession,
  dekiSessionMessageCount,
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
import { Channel } from "@tauri-apps/api/core";
import { ApiError, isDuplicateCreateError } from "./api-errors";
import { planDekiHistoryPersistence, type DekiHistoryPersistenceSnapshot } from "./deki-history-persistence";
import { remoteRuntimeGeneration, remoteRuntimeTarget, streamRemoteJsonEvents } from "./remote-runtime";
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
  messageCount?: unknown;
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
  "read_deki_library",
  "read_deki_library_items",
  "search_deki_code",
  "read_deki_code_file",
  "read_deki_chats",
  "read_deki_chat_messages",
  "read_deki_memories",
  "search_deki_web",
  "read_deki_web_page",
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

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDekiWorkspaceRowChange(value: unknown): DekiWorkspaceRowChange | null {
  const object = asRecord(value);
  const entity = readTrimmedString(object.entity);
  const id = readTrimmedString(object.id);
  const action =
    object.action === "insert" ||
    object.action === "update" ||
    object.action === "replace" ||
    object.action === "delete"
      ? object.action
      : null;
  if (!entity || !id || !action) return null;
  const effect = readTrimmedString(object.effect);
  return {
    entity,
    id,
    action,
    ...("before" in object ? { before: asRecord(object.before) } : {}),
    ...("after" in object ? { after: asRecord(object.after) } : {}),
    ...(effect ? { effect } : {}),
  };
}

function normalizeDekiWorkspacePendingApproval(value: unknown): DekiWorkspacePendingApproval | null {
  const object = asRecord(value);
  const id = readTrimmedString(object.id);
  const sessionId = readTrimmedString(object.sessionId);
  const command = readTrimmedString(object.command);
  const operationHash = readTrimmedString(object.operationHash);
  const requestedAt = readTrimmedString(object.requestedAt);
  const expiresAt = readTrimmedString(object.expiresAt);
  const validationStatus =
    object.validationStatus === "passed" || object.validationStatus === "blocked" ? object.validationStatus : null;
  if (!id || !sessionId || !command || !operationHash || !requestedAt || !expiresAt || !validationStatus) return null;
  return {
    id,
    sessionId,
    command,
    reason: typeof object.reason === "string" && object.reason.trim() ? object.reason : null,
    operationHash,
    requestedAt,
    expiresAt,
    affectedEntities: normalizeDekiWorkspaceCountRecord(object.affectedEntities),
    affectedRows: readFiniteNumber(object.affectedRows) ?? 0,
    validationStatus,
    diffPreview: Array.isArray(object.diffPreview)
      ? object.diffPreview.map(normalizeDekiWorkspaceRowChange).filter((row): row is DekiWorkspaceRowChange => !!row)
      : [],
    diffTruncated: object.diffTruncated === true,
  };
}

function normalizeDekiWorkspacePendingApprovals(value: unknown): DekiWorkspacePendingApproval[] {
  return Array.isArray(value)
    ? value
        .map(normalizeDekiWorkspacePendingApproval)
        .filter((approval): approval is DekiWorkspacePendingApproval => !!approval)
    : [];
}

function currentDekiWorkspaceHistory(value: unknown): DekiWorkspaceHistoryEntry[] {
  return (normalizeDekiWorkspaceHistory(value) ?? []).filter(
    (entry): entry is DekiWorkspaceHistoryEntry => entry.status !== "unknown" && entry.status !== "malformed",
  );
}

/** Normalizes one live workspace event; unknown or malformed events are dropped. */
/** @public Exercised directly by deki-api.test.ts. */
export function normalizeDekiWorkspacePromptEvent(value: unknown): DekiWorkspacePromptEvent | null {
  const object = asRecord(value);
  const data = object.data;
  const record = asRecord(data);
  switch (object.type) {
    case "status": {
      if (typeof data === "string") return data.trim() ? { type: "status", data } : null;
      const content = readTrimmedString(record.content);
      if (!content) return null;
      const kind =
        record.kind === "compaction_start" ||
        record.kind === "compaction_end" ||
        record.kind === "output_limit" ||
        record.kind === "retry" ||
        record.kind === "info"
          ? record.kind
          : undefined;
      const level =
        record.level === "info" || record.level === "warning" || record.level === "error" ? record.level : undefined;
      return { type: "status", data: { content, ...(kind ? { kind } : {}), ...(level ? { level } : {}) } };
    }
    case "tool_start": {
      if (!isDekiWorkspaceToolName(record.name)) return null;
      const id = readTrimmedString(record.id);
      return {
        type: "tool_start",
        data: { ...(id ? { id } : {}), name: record.name, ...("input" in record ? { input: record.input } : {}) },
      };
    }
    case "tool_end": {
      const id = readTrimmedString(record.id);
      return {
        type: "tool_end",
        data: {
          ...(id ? { id } : {}),
          ...(isDekiWorkspaceToolName(record.name) ? { name: record.name } : {}),
          isError: record.isError === true,
          ...(typeof record.output === "string" ? { output: record.output } : {}),
        },
      };
    }
    case "approval_pending": {
      const approval = normalizeDekiWorkspacePendingApproval(data);
      return approval ? { type: "approval_pending", data: approval } : null;
    }
    default:
      return null;
  }
}

function normalizeDekiGatewayResponse(value: unknown): DekiGatewayResponse {
  const record = asRecord(value);
  const workspaceTrace = normalizeDekiWorkspaceTrace(record.workspaceTrace);
  return {
    ...(record as unknown as DekiGatewayResponse),
    workspaceTrace: workspaceTrace ?? undefined,
    pendingApprovals: normalizeDekiWorkspacePendingApprovals(record.pendingApprovals),
  };
}

function normalizeDekiWorkspaceStatus(value: unknown): DekiWorkspaceStatus {
  const record = asRecord(value);
  return {
    ...(record as unknown as DekiWorkspaceStatus),
    pendingApprovals: normalizeDekiWorkspacePendingApprovals(record.pendingApprovals),
    history: currentDekiWorkspaceHistory(record.history),
  };
}

function normalizeDekiApprovalDecision(value: unknown): DekiWorkspaceApprovalDecisionResult {
  const record = asRecord(value);
  const applied = asRecord(record.applied);
  const appliedEntity = readTrimmedString(applied.entity);
  const appliedId = readTrimmedString(applied.id);
  const appliedCommand = readTrimmedString(applied.command);
  return {
    id: readTrimmedString(record.id) ?? "",
    status: record.status === "approved" || record.status === "rejected" ? record.status : "not_found",
    pendingApprovals: normalizeDekiWorkspacePendingApprovals(record.pendingApprovals),
    history: currentDekiWorkspaceHistory(record.history),
    ...(appliedEntity && appliedId && appliedCommand
      ? { applied: { entity: appliedEntity, id: appliedId, command: appliedCommand } }
      : {}),
  };
}

/** The runtime error code behind a failed Deki call, from invoke or SSE errors. */
export function dekiRuntimeErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = asRecord(error.details);
  return readTrimmedString(details.code) ?? readTrimmedString(asRecord(details.data).code);
}

async function promptDekiWithEvents(
  request: DekiEntryRequest,
  onEvent: (event: DekiWorkspacePromptEvent) => void,
): Promise<DekiGatewayResponse> {
  const emit = (raw: unknown) => {
    const event = normalizeDekiWorkspacePromptEvent(raw);
    if (event) onEvent(event);
  };
  if (remoteRuntimeTarget()) {
    for await (const event of streamRemoteJsonEvents("/api/deki/prompt/stream", { request })) {
      if (event.type === "done") return normalizeDekiGatewayResponse(event.data);
      emit(event);
    }
    throw new ApiError("Deki-senpai's live stream ended before a final response.", 502, {
      code: "deki_stream_incomplete",
    });
  }
  const channel = new Channel<unknown>(emit);
  return normalizeDekiGatewayResponse(await invokeTauri<unknown>("deki_prompt_events", { request, onEvent: channel }));
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
  const messageCount = readMessageCount(object.messageCount);
  return {
    id,
    title,
    messages,
    compaction: normalizeDekiCompaction(object.compaction ?? object),
    createdAt,
    updatedAt,
    // A stored count only describes a summary row whose messages are not loaded.
    ...("messageCount" in object && messages.length === 0 ? { messageCount } : {}),
  };
}

function readMessageCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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

async function saveSettingsPatch(
  patch: Record<string, unknown>,
  beforeWrite: () => void = noop,
): Promise<Record<string, unknown>> {
  return saveSettingsTransform((settings) => ({ ...settings, ...patch }), beforeWrite);
}

function noop(): void {}

async function saveSettingsTransform(
  transform: (settings: Record<string, unknown>) => Record<string, unknown>,
  beforeWrite: () => void = noop,
  afterDuplicateCreate = false,
): Promise<Record<string, unknown>> {
  const existing = await storageApi.get<DekiSettingsRecord>("app-settings", DEKI_SETTINGS_ID);
  const legacy = existing ? null : await storageApi.get<DekiSettingsRecord>("app-settings", LEGACY_DEKI_SETTINGS_ID);
  const source = existing ?? legacy;
  const parsed = appSettingsResponseSchema.safeParse(source ?? { value: null });
  const value = transform(asRecord(parsed.success ? parsed.data.value : null));
  const payload = appSettingsUpdateSchema.parse({ value });
  beforeWrite();
  if (existing) {
    await storageApi.update("app-settings", DEKI_SETTINGS_ID, payload);
  } else {
    try {
      await storageApi.create("app-settings", { id: DEKI_SETTINGS_ID, ...payload });
    } catch (error) {
      // Another client created the settings row after this one read it. Apply
      // this change on top of that row instead of replacing its fields.
      if (afterDuplicateCreate || !isDuplicateCreateError(error)) throw error;
      return saveSettingsTransform(transform, beforeWrite, true);
    }
  }
  if (!existing && legacy) {
    await storageApi.delete("app-settings", LEGACY_DEKI_SETTINGS_ID);
  }
  return value;
}

/**
 * `summaryMessageCount` is the stored count (or null if unknown) for a summary
 * row whose messages were not loaded; pass undefined when `messages` is the
 * session's real history.
 */
function normalizeDekiSessionRecord(
  record: DekiSessionRecord,
  messages: DekiMessage[],
  summaryMessageCount: number | null | undefined,
): DekiSession | null {
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
    ...(summaryMessageCount !== undefined ? { messageCount: summaryMessageCount } : {}),
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
  const messageCount = dekiSessionMessageCount(session);
  const createdAt = readTrimmedString(session.createdAt) ?? new Date().toISOString();
  const updatedAt = readTrimmedString(session.updatedAt) ?? createdAt;
  return {
    id: session.id,
    title: readTrimmedString(session.title) ?? titleFromMessages(session.messages),
    compaction: normalizeDekiCompaction(session.compaction),
    createdAt,
    updatedAt,
    ...(messageCount !== null ? { messageCount } : {}),
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
  beforeWrite: () => void = noop,
): Promise<void> {
  const existing = await storageApi.get(entity, id).catch(() => null);
  beforeWrite();
  if (existing) await storageApi.update(entity, id, value);
  else await createUnlessExists(entity, value);
}

/**
 * Creates a migrated row unless another client created the same id first.
 * Two clients first-running against one runtime migrate the same history to
 * the same ids; the first writer's row stands, because by now it may hold
 * newer state (a later message, compaction) that this snapshot would undo.
 */
async function createUnlessExists(entity: StorageEntity, value: Record<string, unknown>): Promise<void> {
  try {
    await storageApi.create(entity, value);
  } catch (error) {
    if (!isDuplicateCreateError(error)) throw error;
  }
}

async function readDekiSessionMessages(sessionId: string, measured: boolean): Promise<DekiMessage[]> {
  const readMessages = () =>
    storageApi.list<DekiMessageRecord>("deki-messages", {
      filters: { sessionId },
      orderBy: "sortOrder",
    });
  const records = measured
    ? await measureDekiStage("deki.active_history", readMessages, (messages) => ({ messageCount: messages.length }))
    : await readMessages();
  return records.map((message) => normalizeDekiMessage(message)).filter((message): message is DekiMessage => !!message);
}

type DurableHistorySnapshot = {
  records: DekiSessionRecord[];
  settings: Record<string, unknown>;
};

async function readDurableHistorySnapshot(): Promise<DurableHistorySnapshot> {
  const [records, settings] = await Promise.all([
    measureDekiStage(
      "deki.session_summaries",
      () =>
        storageApi.list<DekiSessionRecord>("deki-sessions", {
          orderBy: "updatedAt",
          descending: true,
        }),
      (sessions) => ({ sessionCount: sessions.length }),
    ),
    readSettingsValue(),
  ]);
  return { records, settings };
}

async function durableSessionsFromSnapshot(
  { records, settings }: DurableHistorySnapshot,
  hydrateSessionId?: string | null,
): Promise<DekiSessionsState | null> {
  if (records.length === 0) return null;
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
  const loadsMessages = (sessionId: string) => sessionId === messageSessionId || hydrateSessionId === undefined;
  const sessions: DekiSession[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const sessionId = readTrimmedString(record.id);
    if (!sessionId || seen.has(sessionId)) continue;
    const loaded = loadsMessages(sessionId);
    const messages = loaded ? await readDekiSessionMessages(sessionId, sessionId === messageSessionId) : [];
    const session = normalizeDekiSessionRecord(
      { ...record, id: sessionId },
      messages,
      loaded ? undefined : readMessageCount(record.messageCount),
    );
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

/**
 * Writes every session and message in `state`. With `pruneUnlisted`, durable
 * rows that are not in `state` are deleted; finishing an interrupted migration
 * passes false so rows written since then survive. Settings are not touched.
 */
async function saveDurableSessionsState(
  state: DekiSessionsState,
  { pruneUnlisted, beforeWrite }: { pruneUnlisted: boolean; beforeWrite: () => void },
): Promise<void> {
  const normalized = normalizeDekiSessionsState({ activeSessionId: state.activeSessionId, sessions: state.sessions });
  const sessionIds = new Set(normalized.sessions.map((session) => session.id));
  const messageIds = new Set<string>();

  for (const session of normalized.sessions) {
    await writeStorageRecord("deki-sessions", session.id, dekiSessionRecord(session), beforeWrite);
    for (let index = 0; index < session.messages.length; index += 1) {
      const message = session.messages[index]!;
      messageIds.add(message.id);
      await writeStorageRecord("deki-messages", message.id, dekiMessageRecord(session.id, message, index), beforeWrite);
    }
  }
  if (!pruneUnlisted) return;

  const existingSessions = await storageApi.list<DekiSessionRecord>("deki-sessions");
  beforeWrite();
  await Promise.all(
    existingSessions
      .filter((record) => typeof record.id === "string" && !sessionIds.has(record.id))
      .map((record) => storageApi.delete("deki-sessions", record.id)),
  );

  const existingMessages = await storageApi.list<DekiMessageRecord>("deki-messages");
  beforeWrite();
  await Promise.all(
    existingMessages.flatMap((record) => {
      const id = typeof record.id === "string" ? record.id : "";
      return id && !messageIds.has(id) ? [storageApi.delete("deki-messages", id)] : [];
    }),
  );
}

async function saveIncrementalSessionsState(
  previousState: DekiSessionsState,
  nextState: DekiSessionsState,
  beforeWrite: () => void,
): Promise<DekiSessionsState> {
  const previous = normalizeDekiSessionsState(previousState);
  const next = normalizeDekiSessionsState(nextState);
  const plan = planDekiHistoryPersistence(
    dekiHistoryPersistenceSnapshot(previous),
    dekiHistoryPersistenceSnapshot(next),
  );

  for (const record of plan.creates) {
    beforeWrite();
    await storageApi.create(record.entity, record.value);
  }
  for (const record of plan.updates) {
    beforeWrite();
    await storageApi.update(record.entity, record.id, record.value);
  }
  for (const record of plan.deletes) {
    beforeWrite();
    await storageApi.delete(record.entity, record.id);
  }
  await saveSettingsPatch({ activeSessionId: next.activeSessionId }, beforeWrite);
  return next;
}

async function clearLegacyDekiHistorySettings(activeSessionId: string, beforeWrite: () => void): Promise<void> {
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
  }, beforeWrite);
}

// Session reads and writes wait for one shared step that makes durable history
// complete. Without it, concurrent first readers each create the default
// session ("deki-sessions/deki-session-default already exists"), and a caller
// can act on rows a migration has only partly written.
//
// Migration clears the legacy history keys from settings as its last write, so
// legacy keys that are still present mean a migration has not finished, even
// when some durable rows exist. Every read checks this against the storage it
// just read, so switching runtimes never reuses a stale answer.
//
// The remote runtime can change in place (Settings > Remote Runtime URL), and
// storage calls follow the current runtime. A preparation is therefore bound to
// the runtime it started on: it stops before any write once the runtime changes,
// and readers only use results produced for the runtime they are reading.
type DurableHistoryPreparation = { runtime: string; promise: Promise<DekiSessionsState | null> };
let durableHistoryPreparation: DurableHistoryPreparation | null = null;

class DekiHistoryRuntimeChangedError extends Error {
  constructor() {
    super("The runtime changed while Deki history was being read or saved. Try again.");
    this.name = "DekiHistoryRuntimeChangedError";
  }
}

/**
 * Which runtime's storage Deki history calls read and write right now. The
 * generation changes on every Remote Runtime URL change, so switching away and
 * back between two readings also counts as a change.
 */
function dekiHistoryRuntime(): string {
  return `${remoteRuntimeGeneration()}:${remoteRuntimeTarget()?.baseUrl ?? "embedded"}`;
}

function writeGuardFor(runtime: string): () => void {
  return () => {
    if (dekiHistoryRuntime() !== runtime) throw new DekiHistoryRuntimeChangedError();
  };
}

const LEGACY_DEKI_HISTORY_KEYS = [
  "sessions",
  "messages",
  "compaction",
  "compactedSummary",
  "compactedAt",
  "compactedThroughMessageId",
] as const;

function hasLegacyDekiHistory(settings: Record<string, unknown>): boolean {
  return LEGACY_DEKI_HISTORY_KEYS.some((key) => key in settings);
}

function durableHistoryNeedsPreparation({ records, settings }: DurableHistorySnapshot): boolean {
  return records.length === 0 || hasLegacyDekiHistory(settings);
}

/** First run: no durable sessions yet, so the legacy history (or a fresh default) becomes durable. */
async function migrateLegacyDekiHistory(
  settings: Record<string, unknown>,
  beforeWrite: () => void,
): Promise<DekiSessionsState> {
  const legacy = normalizeDekiSessionsState(settings);
  await saveDurableSessionsState(legacy, { pruneUnlisted: true, beforeWrite });
  await clearLegacyDekiHistorySettings(legacy.activeSessionId, beforeWrite);
  return legacy;
}

/**
 * An earlier migration stopped after writing some durable rows. Rewrite every
 * legacy row (writes are upserts), keep durable rows created since, keep the
 * active session if it still exists, and clear the legacy keys last.
 */
async function finishInterruptedDekiHistoryMigration(
  settings: Record<string, unknown>,
  durableSessions: DekiSessionRecord[],
  beforeWrite: () => void,
): Promise<void> {
  const legacy = normalizeDekiSessionsState(settings);
  await saveDurableSessionsState(legacy, { pruneUnlisted: false, beforeWrite });
  const requestedActiveId = readTrimmedString(settings.activeSessionId);
  const knownSessionIds = new Set([
    ...durableSessions.map((record) => readTrimmedString(record.id)),
    ...legacy.sessions.map((session) => session.id),
  ]);
  const activeSessionId =
    requestedActiveId && knownSessionIds.has(requestedActiveId) ? requestedActiveId : legacy.activeSessionId;
  await clearLegacyDekiHistorySettings(activeSessionId, beforeWrite);
}

/** Resolves to the migrated state when this preparation ran a first-run migration, else null. */
function prepareDurableDekiHistory(runtime: string): Promise<DekiSessionsState | null> {
  if (durableHistoryPreparation?.runtime === runtime) return durableHistoryPreparation.promise;
  const previous = durableHistoryPreparation?.promise ?? null;
  const beforeWrite = writeGuardFor(runtime);
  const promise: Promise<DekiSessionsState | null> = (async () => {
    // A preparation for another runtime stops at its next write. Wait for it to
    // settle so two preparations never write at once; its result and errors
    // belong to that runtime's callers.
    if (previous) await previous.then(noop, noop);
    beforeWrite();
    const [sessions, settings] = await Promise.all([
      storageApi.list<DekiSessionRecord>("deki-sessions"),
      readSettingsValue(),
    ]);
    if (sessions.length === 0) return migrateLegacyDekiHistory(settings, beforeWrite);
    if (hasLegacyDekiHistory(settings)) await finishInterruptedDekiHistoryMigration(settings, sessions, beforeWrite);
    return null;
  })().finally(() => {
    // A failed preparation is not cached; the next read checks storage again.
    if (durableHistoryPreparation?.promise === promise) durableHistoryPreparation = null;
  });
  durableHistoryPreparation = { runtime, promise };
  return promise;
}

async function readPreparedDurableHistoryOn(runtime: string): Promise<DurableHistorySnapshot | DekiSessionsState> {
  const inFlight = durableHistoryPreparation;
  if (inFlight?.runtime === runtime) {
    const migrated = await inFlight.promise;
    if (migrated) return migrated;
  }
  const snapshot = await readDurableHistorySnapshot();
  // A preparation that started while this read was in flight may have written
  // part of its rows, so join it instead of trusting the snapshot.
  const started = durableHistoryPreparation?.runtime === runtime;
  if (!started && !durableHistoryNeedsPreparation(snapshot)) return snapshot;
  const migrated = await prepareDurableDekiHistory(runtime);
  return migrated ?? readDurableHistorySnapshot();
}

/**
 * Reads session state from one runtime. The runtime is checked after the
 * summaries and messages are loaded too, so a runtime change at any point
 * discards the whole result and the new runtime is read from scratch.
 *
 * `beforeWrite` throws once the runtime is no longer the one `state` came
 * from. Every write based on `state` calls it first, so a change built from one
 * runtime's history never lands in another runtime's storage.
 */
async function readSessionsStateForWrite(
  hydrateSessionId?: string | null,
): Promise<{ state: DekiSessionsState; beforeWrite: () => void }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const runtime = dekiHistoryRuntime();
    try {
      const prepared = await readPreparedDurableHistoryOn(runtime);
      const state = "records" in prepared ? await durableSessionsFromSnapshot(prepared, hydrateSessionId) : prepared;
      if (dekiHistoryRuntime() !== runtime) continue;
      if (!state) throw new Error("Deki history has no sessions after preparing durable storage.");
      return { state, beforeWrite: writeGuardFor(runtime) };
    } catch (error) {
      if (!(error instanceof DekiHistoryRuntimeChangedError)) throw error;
    }
  }
  throw new Error("The runtime kept changing while Deki history was loading. Try again.");
}

async function readSessionsState(hydrateSessionId?: string | null): Promise<DekiSessionsState> {
  return (await readSessionsStateForWrite(hydrateSessionId)).state;
}

async function saveSessionsState(
  previousState: DekiSessionsState,
  nextState: DekiSessionsState,
  beforeWrite: () => void,
): Promise<DekiSessionsState> {
  return saveIncrementalSessionsState(previousState, nextState, beforeWrite);
}

async function hydrateSelectedDekiSessions(
  state: DekiSessionsState,
  sessionIds: ReadonlySet<string>,
): Promise<DekiSessionsState> {
  const sessions = await Promise.all(
    state.sessions.map(async (session) => {
      if (!sessionIds.has(session.id)) return session;
      const { messageCount: _summaryCount, ...loaded } = session;
      return { ...loaded, messages: await readDekiSessionMessages(session.id, false) };
    }),
  );
  return { activeSessionId: state.activeSessionId, sessions };
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
    sessions: state.sessions.map((item) => {
      if (item.id !== target.id) return item;
      const next = update(target);
      if (next.messages === target.messages || !("messageCount" in next)) return next;
      // New messages replace the summary count; a stale count must never be saved.
      const { messageCount: _summaryCount, ...withMessages } = next;
      return withMessages;
    }),
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
  const { state, beforeWrite } = await readSessionsStateForWrite(sessionId ?? "");
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
  const saved = await saveSessionsState(state, nextState, beforeWrite);
  const session = sessionFromState(saved, sessionId);
  return {
    application: savedApplication,
    messages: session.messages,
    compaction: session.compaction,
  };
}

export const dekiApi = {
  prompt: async (request: DekiEntryRequest): Promise<DekiGatewayResponse> =>
    normalizeDekiGatewayResponse(
      await invokeTauri<unknown>("deki_prompt", {
        request,
      }),
    ),
  promptEvents: promptDekiWithEvents,
  workspace: {
    status: async (sessionId: string, connectionId?: string | null): Promise<DekiWorkspaceStatus> => {
      requireDekiWorkspaceRuntime("deki_workspace_status");
      return normalizeDekiWorkspaceStatus(
        await invokeTauri<unknown>("deki_workspace_status", {
          sessionId,
          connectionId: connectionId ?? null,
        }),
      );
    },
    abort: async (sessionId: string): Promise<DekiWorkspaceAbortResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_abort");
      return invokeTauri<DekiWorkspaceAbortResult>("deki_workspace_abort", { sessionId });
    },
    approve: async (sessionId: string, id: string): Promise<DekiWorkspaceApprovalDecisionResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_approve");
      return normalizeDekiApprovalDecision(await invokeTauri<unknown>("deki_workspace_approve", { sessionId, id }));
    },
    reject: async (sessionId: string, id: string): Promise<DekiWorkspaceApprovalDecisionResult> => {
      requireDekiWorkspaceRuntime("deki_workspace_reject");
      return normalizeDekiApprovalDecision(await invokeTauri<unknown>("deki_workspace_reject", { sessionId, id }));
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
      // Migration rewrites the same settings record; let it finish first, and
      // save to the runtime it finished on.
      const runtime = dekiHistoryRuntime();
      await readPreparedDurableHistoryOn(runtime);
      return normalizePreferences(
        await saveSettingsPatch(
          {
            selectedConnectionId: preferences.selectedConnectionId,
            selectedPersonaId: preferences.selectedPersonaId,
          },
          writeGuardFor(runtime),
        ),
      );
    },
  },
  sessions: {
    list: async (): Promise<DekiSessionsState> => readSessionsState(null),
    create: async (): Promise<DekiSessionsState> => {
      const { state, beforeWrite } = await readSessionsStateForWrite(null);
      const session = createEmptyDekiSession();
      return saveSessionsState(
        state,
        { activeSessionId: session.id, sessions: [session, ...state.sessions] },
        beforeWrite,
      );
    },
    select: async (sessionId: string): Promise<DekiSessionsState> => {
      const { state, beforeWrite } = await readSessionsStateForWrite(null);
      const nextActiveSessionId = state.sessions.some((session) => session.id === sessionId)
        ? sessionId
        : state.activeSessionId;
      return saveSessionsState(state, { ...state, activeSessionId: nextActiveSessionId }, beforeWrite);
    },
    delete: async (sessionId: string): Promise<DekiSessionsState> => {
      return dekiApi.sessions.deleteMany([sessionId]);
    },
    deleteMany: async (sessionIds: readonly string[]): Promise<DekiSessionsState> => {
      const ids = new Set(sessionIds.map((id) => id.trim()).filter(Boolean));
      const { state: summaries, beforeWrite } = await readSessionsStateForWrite(null);
      if (ids.size === 0) return summaries;

      const selectedSessionIds = new Set(
        summaries.sessions.filter((session) => ids.has(session.id)).map((session) => session.id),
      );
      const state = await hydrateSelectedDekiSessions(summaries, selectedSessionIds);

      const remaining = state.sessions.filter((session) => !ids.has(session.id));
      if (remaining.length === state.sessions.length) return state;
      if (remaining.length === 0) {
        const session = createEmptyDekiSession();
        return saveSessionsState(state, { activeSessionId: session.id, sessions: [session] }, beforeWrite);
      }
      const activeSessionId = ids.has(state.activeSessionId) ? remaining[0]!.id : state.activeSessionId;
      return saveSessionsState(state, { activeSessionId, sessions: remaining }, beforeWrite);
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
      const { state, beforeWrite } = await readSessionsStateForWrite(message.sessionId ?? "");
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
      await saveSessionsState(state, nextState, beforeWrite);
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
      const { state, beforeWrite } = await readSessionsStateForWrite(sessionId ?? "");
      const nextCompaction = compactionForMessages(messages, compaction);
      const nextState = updateSession(state, sessionId, (session) => ({
        ...session,
        title: titleFromMessages(messages),
        messages,
        compaction: nextCompaction,
        updatedAt: messages.at(-1)?.createdAt ?? new Date().toISOString(),
      }));
      return historySnapshot(await saveSessionsState(state, nextState, beforeWrite), sessionId);
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
      const { state, beforeWrite } = await readSessionsStateForWrite(sessionId ?? "");
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
      await saveSessionsState(state, nextState, beforeWrite);
      return updatedMessage;
    },
    /** Records the outcome of a data-change approval on the message that proposed it. */
    updateWorkspaceHistoryEntry: async ({
      sessionId,
      messageId,
      entry,
    }: {
      sessionId?: string | null;
      messageId: string;
      entry: DekiWorkspaceHistoryEntry;
    }): Promise<DekiMessage[]> => {
      const { state, beforeWrite } = await readSessionsStateForWrite(sessionId ?? "");
      let found = false;
      const nextState = updateSession(state, sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId || !message.workspaceHistory) return message;
          return {
            ...message,
            workspaceHistory: message.workspaceHistory.map((item) => {
              if (item.status === "unknown" || item.status === "malformed" || item.id !== entry.id) return item;
              found = true;
              return entry;
            }),
          };
        }),
      }));
      if (!found) throw new Error("Deki-senpai's data change could not be found in this chat.");
      return sessionFromState(await saveSessionsState(state, nextState, beforeWrite), sessionId).messages;
    },
    markActionApplied: markDekiActionApplied,
    saveCompaction: async (
      sessionId: string | null | undefined,
      compaction: DekiCompactionState,
    ): Promise<DekiCompactionState> => {
      const { state, beforeWrite } = await readSessionsStateForWrite(sessionId ?? "");
      const nextState = updateSession(state, sessionId, (session) => ({ ...session, compaction }));
      const saved = await saveSessionsState(state, nextState, beforeWrite);
      return sessionFromState(saved, sessionId).compaction;
    },
    reset: async (_sessionId?: string | null): Promise<DekiSessionsState> => {
      const { state, beforeWrite } = await readSessionsStateForWrite(null);
      const session = createEmptyDekiSession();
      return saveSessionsState(
        state,
        { activeSessionId: session.id, sessions: [session, ...state.sessions] },
        beforeWrite,
      );
    },
  },
};
