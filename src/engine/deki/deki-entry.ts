export type DekiWorkspaceToolName = "read" | "grep" | "find" | "ls" | "deki_data" | "deki_code";

export type DekiWorkspaceToolTrace = {
  id: string;
  name: DekiWorkspaceToolName;
  status: "running" | "done" | "error";
  input?: unknown;
  output?: string | null;
  updatedAt?: number;
};

export type DekiWorkspaceTraceItem =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "status"; content: string }
  | { type: "tool"; tool: DekiWorkspaceToolTrace };

export type DekiWorkspaceConnectionSummary = {
  id: string;
  name: string;
  provider: string;
  model: string;
};

export type DekiWorkspaceValidationIssue = {
  level: "error" | "notice" | "info";
  entity?: string;
  id?: string | null;
  message: string;
};

export type DekiWorkspaceValidationResult = {
  status: "passed" | "blocked";
  errors: DekiWorkspaceValidationIssue[];
  notices: DekiWorkspaceValidationIssue[];
  infos: DekiWorkspaceValidationIssue[];
};

export type DekiWorkspaceRowChange = {
  entity: string;
  id: string;
  action: "insert" | "update" | "replace" | "delete";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export type DekiWorkspaceDiffSummary = {
  matchedRows: number;
  affectedRows: number;
  insertedRows: number;
  updatedRows: number;
  replacedRows: number;
  deletedRows: number;
  affectedEntities: Record<string, number>;
  preview: DekiWorkspaceRowChange[];
  truncated: boolean;
};

export type DekiWorkspaceCommandResult = {
  ok: boolean;
  mode: "read" | "dry-run" | "apply";
  command: string;
  output?: unknown;
  summary?: DekiWorkspaceDiffSummary;
  validation?: DekiWorkspaceValidationResult;
  approval?: {
    status: "not_required" | "pending" | "approved" | "rejected" | "cancelled" | "timed_out" | "state_changed";
    id?: string;
    operationHash?: string;
  };
  journalPath?: string | null;
  error?: string;
};

export type DekiWorkspacePendingApproval = {
  id: string;
  sessionId: string;
  command: string;
  reason: string | null;
  operationHash: string;
  requestedAt: string;
  expiresAt: string;
  affectedEntities: Record<string, number>;
  affectedRows: number;
  validationStatus: "passed" | "blocked";
  diffPreview: DekiWorkspaceRowChange[];
  diffTruncated: boolean;
};

export type DekiWorkspaceHistoryEntry = {
  id: string;
  sessionId: string;
  command: string;
  reason: string | null;
  status: "dry-run" | "approved" | "rejected" | "cancelled" | "timed_out" | "blocked" | "state_changed" | "failed";
  operationHash?: string;
  affectedEntities: Record<string, number>;
  affectedRows: number;
  validationStatus: "passed" | "blocked";
  journalPath?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type DekiWorkspaceStatus = {
  enabled: boolean;
  workspace: string | null;
  dataDir: string | null;
  tools: DekiWorkspaceToolName[];
  dataAccess: "server-managed";
  connection: DekiWorkspaceConnectionSummary | null;
  active: boolean;
  pendingApprovals: DekiWorkspacePendingApproval[];
  history: DekiWorkspaceHistoryEntry[];
  error?: string | null;
};

export type DekiWorkspaceStatusEvent =
  | string
  | {
      content: string;
      kind?: "compaction_start" | "compaction_end" | "output_limit" | "retry" | "info";
      level?: "info" | "warning" | "error";
      reason?: string;
    };

export type DekiWorkspacePromptEvent =
  | { type: "token"; data: string }
  | { type: "thinking"; data: string }
  | { type: "status"; data: DekiWorkspaceStatusEvent }
  | { type: "tool_start"; data: { id?: string; name: DekiWorkspaceToolName; input?: unknown } }
  | { type: "tool_update"; data: { id?: string; name?: DekiWorkspaceToolName; output?: string } }
  | { type: "tool_end"; data: { id?: string; name?: DekiWorkspaceToolName; isError?: boolean; output?: string } }
  | { type: "approval_pending"; data: DekiWorkspacePendingApproval }
  | { type: "metadata"; data: Record<string, unknown> }
  | { type: "done"; data?: unknown }
  | { type: "error"; data: string };

export type DekiWorkspaceAbortResult = {
  aborted: boolean;
  active: boolean;
  reason?: string | null;
};

export type DekiWorkspaceApprovalDecisionResult = {
  id: string;
  status: "approved" | "rejected" | "not_found";
  pendingApprovals: DekiWorkspacePendingApproval[];
  history: DekiWorkspaceHistoryEntry[];
};

export type DekiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  action?: DekiEntryAction | null;
  actionApplication?: DekiActionApplication | null;
  workspaceTrace?: DekiWorkspaceTraceItem[];
  workspaceHistory?: DekiWorkspaceHistoryEntry[];
};

export type DekiAttachment = {
  id?: string;
  name: string;
  type: string;
  size: number;
  content: string;
};

export type DekiPersonaContext = {
  id?: string | null;
  name?: string | null;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

export type DekiEntryRequest = {
  userMessage: string;
  messages: DekiMessage[];
  compactedSummary?: string | null;
  connectionId?: string | null;
  persona?: DekiPersonaContext | null;
  attachments?: DekiAttachment[];
};

const DEKI_ACTION_ENTITIES = [
  "characters",
  "character-groups",
  "personas",
  "persona-groups",
  "lorebooks",
  "lorebook-entries",
  "prompts",
  "prompt-sections",
  "prompt-groups",
  "prompt-variables",
] as const;

export type DekiActionEntity = (typeof DEKI_ACTION_ENTITIES)[number];

export type DekiEntryAction =
  | {
      type: "none";
      capability: "read_only" | "workspace_agent";
      reason: string;
    }
  | {
      type: "create_record";
      entity: DekiActionEntity;
      draft: Record<string, unknown>;
      label?: string;
      rationale?: string;
    }
  | {
      type: "edit_record";
      entity: DekiActionEntity;
      id: string;
      patch: Record<string, unknown>;
      label?: string;
      rationale?: string;
    };

export type DekiActionApplication = {
  status: "applied";
  appliedAt: string;
  resultId?: string | null;
};

const DEKI_DEFAULT_ACTION_REASON =
  "Deki-senpai can inspect De-Koi's codebase, create extension/custom-agent records, and apply exact code edits through approved workspace tools.";

const DEKI_DEFAULT_ACTION: DekiEntryAction = {
  type: "none",
  capability: "workspace_agent",
  reason: DEKI_DEFAULT_ACTION_REASON,
};

export type DekiEntryResponse = {
  content: string;
  createdAt: string;
  action: DekiEntryAction;
};

export type DekiGatewayResponse = Omit<DekiEntryResponse, "action"> & {
  action?: unknown;
};

export type DekiGateway = {
  prompt(input: DekiEntryRequest): Promise<DekiGatewayResponse>;
};

export async function runDekiEntry(input: DekiEntryRequest, gateway: DekiGateway): Promise<DekiEntryResponse> {
  const response = await gateway.prompt({
    ...input,
    userMessage: input.userMessage.trim(),
    messages: input.messages.slice(),
    compactedSummary: input.compactedSummary ?? null,
    attachments: input.attachments ?? [],
    connectionId: input.connectionId ?? null,
    persona: input.persona ?? null,
  });
  const content = typeof response.content === "string" ? response.content : "";
  if (!content.trim()) {
    throw new Error("Deki-senpai returned an empty response. Try again or select a different tool-capable connection.");
  }
  return {
    ...response,
    content,
    action: normalizeDekiEntryAction(response.action),
  };
}

export function normalizeDekiEntryAction(value: unknown): DekiEntryAction {
  if (!isRecord(value)) return DEKI_DEFAULT_ACTION;
  if (value.type === "none" && (value.capability === "read_only" || value.capability === "workspace_agent")) {
    return {
      type: "none",
      capability: value.capability,
      reason: typeof value.reason === "string" && value.reason.trim() ? value.reason : DEKI_DEFAULT_ACTION_REASON,
    };
  }
  if (value.type === "create_record" && isDekiActionEntity(value.entity) && isRecord(value.draft)) {
    return {
      type: "create_record",
      entity: value.entity,
      draft: value.draft,
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    };
  }
  if (
    value.type === "edit_record" &&
    isDekiActionEntity(value.entity) &&
    typeof value.id === "string" &&
    value.id.trim() &&
    isRecord(value.patch)
  ) {
    return {
      type: "edit_record",
      entity: value.entity,
      id: value.id,
      patch: value.patch,
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    };
  }
  return DEKI_DEFAULT_ACTION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDekiActionEntity(value: unknown): value is DekiActionEntity {
  return typeof value === "string" && DEKI_ACTION_ENTITIES.includes(value as DekiActionEntity);
}
