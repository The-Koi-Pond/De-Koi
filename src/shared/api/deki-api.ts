import {
  normalizeDekiEntryAction,
  type DekiActionApplication,
  type DekiActionEntity,
  type DekiEntryAction,
  type DekiEntryRequest,
  type DekiGatewayResponse,
  type DekiWorkspaceHistoryItem,
  type DekiMessage,
  type DekiWorkspaceAbortResult,
  type DekiWorkspaceApprovalDecisionResult,
  type DekiWorkspaceHistoryEntry,
  type DekiWorkspaceStatus,
  type DekiWorkspaceToolName,
  type DekiWorkspaceTraceItem,
} from "../../engine/deki/deki-entry";
import { EMPTY_DEKI_COMPACTION, type DekiCompactionState } from "../../engine/deki/deki-history";
import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import {
  createChoiceBlockSchema,
  createPromptGroupSchema,
  createPromptSectionSchema,
  updatePromptPresetSchema,
} from "../../engine/contracts/schemas/prompt.schema";
import type { StorageEntity } from "../../engine/capabilities/storage";
import { ApiError } from "./api-errors";
import { storageApi } from "./storage-api";
import { remoteRuntimeTarget } from "./remote-runtime";
import { hasEmbeddedTauriIpc, invokeTauri } from "./tauri-client";

const DEKI_SETTINGS_ID = "deki";
const LEGACY_DEKI_SETTINGS_ID = "professor-mari";

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
  const id = readTrimmedString(object.id);
  const sessionId = readTrimmedString(object.sessionId);
  const command = readTrimmedString(object.command);
  const status = isDekiWorkspaceHistoryStatus(object.status) ? object.status : null;
  const validationStatus =
    object.validationStatus === "passed" || object.validationStatus === "blocked" ? object.validationStatus : null;
  const createdAt = readTrimmedString(object.createdAt);
  if (!id || !sessionId || !command || !status || !validationStatus || !createdAt) {
    return isCurrentDekiWorkspaceHistoryShape(object)
      ? malformedDekiWorkspaceHistoryItem(value, "Workspace history entry is missing required current-contract fields.")
      : unknownDekiWorkspaceHistoryItem(value);
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

function malformedDekiWorkspaceHistoryItem(value: unknown, reason: string): DekiWorkspaceHistoryItem {
  const object = asRecord(value);
  const id = readTrimmedString(object.id);
  const createdAt = readTrimmedString(object.createdAt);
  return {
    status: "malformed",
    raw: value,
    reason,
    ...(id ? { id } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function isCurrentDekiWorkspaceHistoryShape(object: Record<string, unknown>): boolean {
  return [
    "sessionId",
    "command",
    "reason",
    "operationHash",
    "affectedEntities",
    "affectedRows",
    "validationStatus",
    "journalPath",
    "completedAt",
  ].some((key) => key in object);
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

function unavailableDekiWorkspaceStatus(connectionId?: string | null): DekiWorkspaceStatus {
  const requestedConnection = readTrimmedString(connectionId);
  return {
    enabled: false,
    workspace: null,
    dataDir: null,
    tools: Array.from(DEKI_WORKSPACE_TOOL_NAMES),
    dataAccess: "server-managed",
    connection: null,
    active: false,
    pendingApprovals: [],
    history: [],
    error: requestedConnection
      ? `${DEKI_WORKSPACE_UNAVAILABLE_REASON} Requested connection: ${requestedConnection}.`
      : DEKI_WORKSPACE_UNAVAILABLE_REASON,
  };
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

function createDekiMessage(message: {
  role: "user" | "assistant";
  content: string;
  action?: DekiEntryAction | null;
  workspaceTrace?: DekiWorkspaceTraceItem[];
  workspaceHistory?: DekiWorkspaceHistoryItem[];
}): DekiMessage {
  const nonce =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next: DekiMessage = {
    id: `deki-message-${nonce}`,
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
  const source = existing ?? (await readSettingsRecord());
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
  return value;
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
): Promise<DekiActionApplication> {
  const status = await writeDekiActionApplication(messageId, application);
  return status.application;
}

async function writeDekiActionApplication(
  messageId: string,
  application: DekiActionApplication,
): Promise<{
  application: DekiActionApplication;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
}> {
  const settings = await readSettingsValue();
  const messages = normalizeDekiMessages(settings);
  let savedApplication: DekiActionApplication | null = null;
  const updatedMessages = messages.map((message) =>
    message.id === messageId && message.action && message.action.type !== "none"
      ? (() => {
          savedApplication = message.actionApplication?.status === "applied" ? message.actionApplication : application;
          return { ...message, actionApplication: savedApplication };
        })()
      : message,
  );
  if (!savedApplication) {
    throw new Error("Deki-senpai action message was not found.");
  }
  const nextSettings = await saveSettingsPatch({ messages: updatedMessages });
  return {
    application: savedApplication,
    messages: normalizeDekiMessages(nextSettings),
    compaction: normalizeDekiCompaction(nextSettings),
  };
}

export const dekiApi = {
  prompt: (request: DekiEntryRequest) =>
    invokeTauri<DekiGatewayResponse>("deki_prompt", {
      request,
    }),
  workspace: {
    status: async (connectionId?: string | null): Promise<DekiWorkspaceStatus> => {
      if (!hasDekiWorkspaceRuntime()) return unavailableDekiWorkspaceStatus(connectionId);
      return invokeTauri<DekiWorkspaceStatus>("deki_workspace_status", {
        connectionId: connectionId ?? null,
      });
    },
    abort: async (): Promise<DekiWorkspaceAbortResult> => {
      if (!hasDekiWorkspaceRuntime()) {
        return {
          aborted: false,
          active: false,
          reason: DEKI_WORKSPACE_UNAVAILABLE_REASON,
        };
      }
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
    apply: async (
      action: DekiEntryAction,
      options?: { actionId?: string; messageId?: string },
    ): Promise<DekiActionApplyResult> => {
      if (action.type === "none") {
        throw new Error("Deki-senpai did not provide an applyable action.");
      }
      const storageEntity = storageEntityForDekiAction(action.entity);
      const result =
        action.type === "create_record"
          ? await applyCreateDekiAction(action, options?.actionId)
          : await storageApi.update(storageEntity, action.id, action.patch);
      const resultId = recordId(result);
      const appliedStatus = options?.messageId
        ? await writeDekiActionApplication(options.messageId, {
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
  history: {
    get: async (): Promise<{ messages: DekiMessage[]; compaction: DekiCompactionState }> => {
      const settings = await readSettingsValue();
      return {
        messages: normalizeDekiMessages(settings),
        compaction: normalizeDekiCompaction(settings),
      };
    },
    appendMessage: async (message: {
      role: "user" | "assistant";
      content: string;
      action?: DekiEntryAction | null;
      workspaceTrace?: DekiWorkspaceTraceItem[];
      workspaceHistory?: DekiWorkspaceHistoryItem[];
    }): Promise<DekiMessage> => {
      const settings = await readSettingsValue();
      const nextMessage = createDekiMessage(message);
      await saveSettingsPatch({
        messages: [...normalizeDekiMessages(settings), nextMessage],
      });
      return nextMessage;
    },
    markActionApplied: markDekiActionApplied,
    saveCompaction: async (compaction: DekiCompactionState): Promise<DekiCompactionState> =>
      normalizeDekiCompaction(
        await saveSettingsPatch({
          compactedSummary: compaction.compactedSummary,
          compactedAt: compaction.compactedAt,
          compactedThroughMessageId: compaction.compactedThroughMessageId,
        }),
      ),
    reset: async (): Promise<void> => {
      await saveSettingsPatch({ ...EMPTY_DEKI_COMPACTION, messages: [] });
    },
  },
};
