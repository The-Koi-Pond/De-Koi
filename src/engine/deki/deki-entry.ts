export type DekiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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
    throw new Error(
      "Deki-senpai returned an empty response. Try again or select a different tool-capable connection.",
    );
  }
  return {
    ...response,
    content,
    action: normalizeDekiEntryAction(response.action),
  };
}

function normalizeDekiEntryAction(value: unknown): DekiEntryAction {
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
