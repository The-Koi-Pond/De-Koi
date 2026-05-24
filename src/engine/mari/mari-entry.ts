export type MariMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type MariAttachment = {
  id?: string;
  name: string;
  type: string;
  size: number;
  content: string;
};

export type MariPersonaContext = {
  id?: string | null;
  name?: string | null;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

export type MariEntryRequest = {
  userMessage: string;
  messages: MariMessage[];
  connectionId?: string | null;
  persona?: MariPersonaContext | null;
  attachments?: MariAttachment[];
};

export const MARI_ACTION_ENTITIES = [
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

export type MariActionEntity = (typeof MARI_ACTION_ENTITIES)[number];

export type MariEntryAction =
  | {
      type: "none";
      capability: "read_only";
      reason: string;
    }
  | {
      type: "create_record";
      entity: MariActionEntity;
      draft: Record<string, unknown>;
      label?: string;
      rationale?: string;
    }
  | {
      type: "edit_record";
      entity: MariActionEntity;
      id: string;
      patch: Record<string, unknown>;
      label?: string;
      rationale?: string;
    };

const MARI_READ_ONLY_REASON = "Professor Mari v1 can inspect the creative library but cannot create or edit records.";

export const MARI_READ_ONLY_ACTION: MariEntryAction = {
  type: "none",
  capability: "read_only",
  reason: MARI_READ_ONLY_REASON,
};

export type MariEntryResponse = {
  content: string;
  createdAt: string;
  action: MariEntryAction;
};

export type MariGatewayResponse = Omit<MariEntryResponse, "action"> & {
  action?: unknown;
};

export type MariGateway = {
  prompt(input: MariEntryRequest): Promise<MariGatewayResponse>;
};

export async function runProfessorMariEntry(input: MariEntryRequest, gateway: MariGateway): Promise<MariEntryResponse> {
  const response = await gateway.prompt({
    ...input,
    userMessage: input.userMessage.trim(),
    messages: input.messages.slice(),
    attachments: input.attachments ?? [],
    connectionId: input.connectionId ?? null,
    persona: input.persona ?? null,
  });
  return {
    ...response,
    action: normalizeMariEntryAction(response.action),
  };
}

function normalizeMariEntryAction(value: unknown): MariEntryAction {
  if (!isRecord(value)) return MARI_READ_ONLY_ACTION;
  if (value.type === "none" && value.capability === "read_only") {
    return {
      type: "none",
      capability: "read_only",
      reason: typeof value.reason === "string" && value.reason.trim() ? value.reason : MARI_READ_ONLY_REASON,
    };
  }
  if (value.type === "create_record" && isMariActionEntity(value.entity) && isRecord(value.draft)) {
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
    isMariActionEntity(value.entity) &&
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
  return MARI_READ_ONLY_ACTION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMariActionEntity(value: unknown): value is MariActionEntity {
  return typeof value === "string" && MARI_ACTION_ENTITIES.includes(value as MariActionEntity);
}
