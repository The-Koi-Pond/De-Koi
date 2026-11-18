// The one place scene planning and summary calls reach the model, and the only place that picks their connection.
// The opening reply is not one of these calls: it is an ordinary Roleplay generation in the scene chat.
// Behavior spec: docs/provenance/roleplay-scenes.md ("Model calls").
import type { LlmMessage } from "../../../capabilities/llm";
import type { StorageGateway } from "../../../capabilities/storage";
import { resolveGenerationConnection } from "../../../generation/context";
import { isRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { userFacingError } from "../../../shared/user-facing-error";
import type { SceneCallKind, SceneCapabilities } from "./scene-types";

interface SceneCallParameters {
  temperature: number;
  maxTokens: number;
  /** Budget for the single retry after the provider sent no assistant text; null means no retry. */
  emptyAnswerRetryMaxTokens: number | null;
  /** Summary calls ask the provider not to spend the budget on reasoning. */
  noReasoning: boolean;
}

const SCENE_CALL_PARAMETERS: Record<SceneCallKind, SceneCallParameters> = {
  plan: { temperature: 0.9, maxTokens: 4096, emptyAnswerRetryMaxTokens: null, noReasoning: false },
  section_summary: { temperature: 0.45, maxTokens: 700, emptyAnswerRetryMaxTokens: 2048, noReasoning: true },
  whole_summary: { temperature: 0.5, maxTokens: 1400, emptyAnswerRetryMaxTokens: 2800, noReasoning: true },
  whole_summary_retry: { temperature: 0.35, maxTokens: 2800, emptyAnswerRetryMaxTokens: 2800, noReasoning: true },
};

const MISSING_CONNECTION_MESSAGE =
  "There's no model connection for this scene. Pick one in Chat Settings or add one in Connections.";
const EMPTY_RANDOM_POOL_MESSAGE =
  "No connections are in the random pool. Add one in Connections or pick a connection in Chat Settings.";

// What `resolveGenerationConnection` says when there is nothing to use. Its errors carry no code, so the exact
// wording is matched; any other failure keeps its own message.
const RESOLVER_MISSING_CONNECTION: Record<string, string> = {
  "API connection was not found": MISSING_CONNECTION_MESSAGE,
  "Chat connection was not found": MISSING_CONNECTION_MESSAGE,
  "Connection was not found": MISSING_CONNECTION_MESSAGE,
  "No connections are marked for the random pool": EMPTY_RANDOM_POOL_MESSAGE,
};

const EMPTY_ANSWER_TEXT = /did not contain assistant text|empty assistant|no final assistant text/i;

/**
 * Which connection a run of scene calls uses: the chat's own, or the override. It resolves once, on first use, so a
 * "random" choice picks one connection for every call of the run.
 */
export interface SceneConnection {
  readonly chat: JsonRecord;
  readonly override: string | null;
  resolved: Promise<JsonRecord> | null;
}

export function sceneConnection(chat: JsonRecord, override?: string | null): SceneConnection {
  return { chat, override: readString(override).trim() || null, resolved: null };
}

async function resolveOnce(storage: StorageGateway, connection: SceneConnection): Promise<JsonRecord> {
  if (!connection.resolved) {
    connection.resolved = resolveGenerationConnection(storage, connection.chat, {
      connectionId: connection.override,
    }).catch((error: unknown) => {
      const missing = error instanceof Error ? RESOLVER_MISSING_CONNECTION[error.message] : undefined;
      throw missing ? userFacingError(missing) : error;
    });
  }
  const resolved = await connection.resolved;
  if (!readString(resolved.id).trim()) throw userFacingError(MISSING_CONNECTION_MESSAGE);
  return resolved;
}

/** The connection a run used, for records that name it (the story episode's summarizer). */
export async function sceneConnectionDetails(
  storage: StorageGateway,
  connection: SceneConnection,
): Promise<{ connectionId: string; provider: string | null; model: string | null }> {
  const resolved = await resolveOnce(storage, connection);
  return {
    connectionId: readString(resolved.id).trim(),
    provider: readString(resolved.provider).trim() || null,
    model: readString(resolved.model).trim() || null,
  };
}

function callParameters(kind: SceneCallKind, maxTokens: number): Record<string, unknown> {
  const parameters = SCENE_CALL_PARAMETERS[kind];
  return {
    temperature: parameters.temperature,
    maxTokens,
    ...(parameters.noReasoning
      ? {
          reasoningEffort: "none",
          reasoning_effort: "none",
          customParameters: { reasoning_effort: "none", reasoning: { exclude: true } },
        }
      : {}),
  };
}

function errorTexts(error: unknown, depth = 0): string[] {
  if (depth > 3 || error === null || error === undefined) return [];
  if (typeof error === "string") return [error];
  if (!isRecord(error) && !(error instanceof Error)) return [];
  const record = error as Error & { cause?: unknown; details?: unknown };
  const texts = [readString(record.message)];
  if (record.details !== undefined) {
    try {
      texts.push(typeof record.details === "string" ? record.details : JSON.stringify(record.details));
    } catch {
      // Details that can't be written out can't say the answer was empty either.
    }
  }
  return [...texts, ...errorTexts(record.cause, depth + 1)];
}

/** The provider answered without any assistant text (some spend the whole budget on hidden reasoning). */
function isEmptyAnswerError(error: unknown): boolean {
  return errorTexts(error).some((text) => EMPTY_ANSWER_TEXT.test(text));
}

/**
 * Every scene planning and summary call: the run's connection, the kind's parameters, and one retry with a larger
 * budget when the provider sent no assistant text.
 */
export async function requestSceneText(
  capabilities: SceneCapabilities,
  request: { kind: SceneCallKind; connection: SceneConnection; messages: LlmMessage[] },
): Promise<string> {
  const connectionId = readString((await resolveOnce(capabilities.storage, request.connection)).id).trim();
  const parameters = SCENE_CALL_PARAMETERS[request.kind];
  const call = (maxTokens: number) =>
    capabilities.llm.complete({
      connectionId,
      messages: request.messages,
      parameters: callParameters(request.kind, maxTokens),
    });
  try {
    return await call(parameters.maxTokens);
  } catch (error) {
    if (parameters.emptyAnswerRetryMaxTokens === null || !isEmptyAnswerError(error)) throw error;
    return call(parameters.emptyAnswerRetryMaxTokens);
  }
}
