// The one place campaign building and running reach a model, and the only place that picks their connection.
import type { z } from "zod";

import type { LlmGateway, LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { resolveGenerationConnection } from "../../../generation/context";
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
  reasoningEffort: "low" | "medium";
}

const SETTINGS: Record<CampaignCallKind, CallSettings> = {
  bible: { temperature: 0.95, maxTokens: 6_000, reasoningEffort: "medium" },
  situations: { temperature: 0.9, maxTokens: 12_000, reasoningEffort: "medium" },
  review: { temperature: 0.7, maxTokens: 12_000, reasoningEffort: "medium" },
  content: { temperature: 0.8, maxTokens: 9_000, reasoningEffort: "medium" },
  tick: { temperature: 0.1, maxTokens: 1_500, reasoningEffort: "low" },
  replan: { temperature: 0.8, maxTokens: 10_000, reasoningEffort: "medium" },
};

const NO_CONNECTION = "There's no model connection to build the campaign with. Add one in Connections.";

/** The connection that builds a campaign: the one picked for it, else the app default. */
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
 * The connection the runner's read of each exchange uses: the Campaign Helper Models route when set, else the chat's
 * own connection. Replans always use the chat's connection: they write story.
 */
export async function campaignRunConnection(
  storage: StorageGateway,
  chat: JsonRecord,
  kind: "tick" | "replan",
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
  await noteHelperRun(storage, {
    task: "campaign",
    rule: chatConnectionRule(connection, chat.connectionId),
    connectionId: id,
    connection,
    job: kind === "tick" ? "read" : "replan",
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
  },
  signal?: AbortSignal,
): Promise<T> {
  const settings = SETTINGS[request.kind];
  const result = await generateStructured(
    capabilities,
    {
      taskName: `campaign_${request.kind}`,
      connectionId: request.connectionId,
      messages: request.messages,
      parameters: {
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        reasoningEffort: settings.reasoningEffort,
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
