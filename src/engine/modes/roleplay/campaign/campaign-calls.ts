// The one place campaign building and running reach a model, and the only place that picks their connection.
import type { z } from "zod";

import type { LlmGateway, LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { resolveGenerationConnection } from "../../../generation/context";
import { noteHelperPick, pickHelperConnection } from "../../../generation/helper-connection";
import { chatConnectionRule, noteHelperRun, resolveHelperRoute } from "../../../generation/helper-runs";
import { readString, type JsonRecord } from "../../../generation/runtime-records";
import { generateStructured } from "../../../generation/structured-generation";
import { userFacingError } from "../../../shared/user-facing-error";

export interface CampaignCapabilities {
  storage: StorageGateway;
  llm: LlmGateway;
}

export type CampaignCallKind = "bible" | "situations" | "review" | "content" | "tick" | "replan";

interface CallSettings {
  temperature: number;
  maxTokens: number;
  /** Unset leaves the effort to the connection's own defaults, which the transport fits to its model. */
  reasoningEffort?: "low";
}

const SETTINGS: Record<CampaignCallKind, CallSettings> = {
  bible: { temperature: 0.95, maxTokens: 6_000 },
  situations: { temperature: 0.9, maxTokens: 12_000 },
  review: { temperature: 0.7, maxTokens: 12_000 },
  content: { temperature: 0.8, maxTokens: 9_000 },
  tick: { temperature: 0.1, maxTokens: 1_500, reasoningEffort: "low" },
  replan: { temperature: 0.8, maxTokens: 10_000 },
};

const NO_CONNECTION = "There's no model connection to build the campaign with. Add one in Connections.";
const PLANNING_GONE =
  "The campaign's planning model no longer exists. Pick another one in Connections → Helper Models.";

/** The story model a campaign is played on: the one picked for it, else the app default. */
export async function campaignBuildConnection(storage: StorageGateway, connectionId: string | null): Promise<string> {
  let connection: JsonRecord;
  try {
    connection = await resolveGenerationConnection(storage, {}, { connectionId });
  } catch (error) {
    if (error instanceof Error && /not found|random pool/i.test(error.message)) throw userFacingError(NO_CONNECTION);
    throw error;
  }
  const id = readString(connection.id).trim();
  if (!id) throw userFacingError(NO_CONNECTION);
  return id;
}

/**
 * The planning model: the one picked when the campaign was built, else the Campaign planning Helper Models route, else
 * the story model (`storyConnectionId`, already resolved). Picked the way fanfic picks its planning model.
 */
export async function campaignPlanningConnection(
  storage: StorageGateway,
  input: {
    storyConnectionId: string;
    planningConnectionId: string | null;
    job: "build" | "replan";
    chatId?: string | null;
    /** The chat's own connection setting, to say why an unrouted plan ran on the story model. */
    chatConnectionId?: unknown;
  },
): Promise<string> {
  const pickInput = {
    connectionId: input.planningConnectionId,
    job: input.job,
    chatId: input.chatId,
    missing: NO_CONNECTION,
    gone: PLANNING_GONE,
    note: false,
  };
  const pick = await pickHelperConnection(
    storage,
    "campaignPlanning",
    { connectionId: input.storyConnectionId },
    pickInput,
  );
  if (pick.rule === "chat" && pick.connection) {
    const rule = chatConnectionRule(pick.connection, input.chatConnectionId ?? input.storyConnectionId);
    await noteHelperPick(storage, "campaignPlanning", pickInput, { ...pick, rule });
  } else {
    await noteHelperPick(storage, "campaignPlanning", pickInput, pick);
  }
  return pick.connectionId;
}

/**
 * The connection the runner's read of each exchange uses: the Campaign Helper Models route when set, else the chat's
 * own connection. Replans are planning: they go through {@link campaignPlanningConnection}.
 */
export async function campaignRunConnection(
  storage: StorageGateway,
  chat: JsonRecord,
  kind: "tick" | "replan",
  planningConnectionId: string | null = null,
): Promise<string> {
  const chatId = readString(chat.id).trim();
  if (kind === "tick") {
    const routed = await resolveHelperRoute(storage, "campaign", { chatId, job: "read" });
    if (routed) {
      const id = readString(routed.id).trim();
      await noteHelperRun(storage, {
        task: "campaign",
        rule: "route",
        connectionId: id,
        connection: routed,
        job: "read",
        chatId,
      });
      return id;
    }
  }
  const connection = await resolveGenerationConnection(storage, chat, {});
  const id = readString(connection.id).trim();
  if (kind === "replan") {
    return campaignPlanningConnection(storage, {
      storyConnectionId: id,
      planningConnectionId,
      job: "replan",
      chatId,
      chatConnectionId: chat.connectionId,
    });
  }
  await noteHelperRun(storage, {
    task: "campaign",
    rule: chatConnectionRule(connection, chat.connectionId),
    connectionId: id,
    connection,
    job: "read",
    chatId,
  });
  return id;
}

export class CampaignCallError extends Error {
  readonly code = "user_facing";
  constructor(
    readonly kind: CampaignCallKind,
    message: string,
    readonly details: string[],
  ) {
    super(message);
  }
}

const FAILURE: Record<CampaignCallKind, string> = {
  bible: "The model's campaign bible wasn't usable.",
  situations: "The model's situations weren't usable.",
  review: "The model's revised situations weren't usable.",
  content: "The model's narrator card, lorebook and opening weren't usable.",
  tick: "The model's read of the last exchange wasn't usable.",
  replan: "The model's replan wasn't usable.",
};

/** One structured campaign call with a single repair attempt. Throws {@link CampaignCallError} with the reason. */
export async function campaignCall<T>(
  capabilities: CampaignCapabilities,
  request: {
    kind: CampaignCallKind;
    connectionId: string;
    messages: LlmMessage[];
    schema: z.ZodType<T>;
    shape: string;
    /** The player's pick for planning, over the call's own effort; null or unset keeps the call's. */
    reasoningEffort?: string | null;
  },
  signal?: AbortSignal,
): Promise<T> {
  const settings = SETTINGS[request.kind];
  const reasoningEffort = request.reasoningEffort ?? settings.reasoningEffort;
  const result = await generateStructured(
    capabilities,
    {
      taskName: `campaign_${request.kind}`,
      connectionId: request.connectionId,
      messages: request.messages,
      parameters: {
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      schema: request.schema,
      schemaDescription: request.shape,
      maxRepairAttempts: 1,
      failureMessage: FAILURE[request.kind],
    },
    signal,
  );
  if (!result.ok) {
    throw new CampaignCallError(
      request.kind,
      `${FAILURE[request.kind]} Try again, or switch to a stronger model.`,
      result.failure.validationErrors.slice(0, 6),
    );
  }
  return result.data;
}
