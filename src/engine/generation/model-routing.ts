import type { StorageGateway } from "../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import { parseJsonObject } from "../core/json";
import { boolish, readString, type JsonRecord } from "./runtime-records";

/**
 * Helper Models: send a class of background helper work to one chosen
 * connection. A task without a route keeps the connection it used before
 * routing existed, so nothing changes until the user picks a route. A routed
 * task never falls back: a broken route throws {@link ModelRouteError}.
 */

export const MODEL_ROUTING_SETTINGS_ID = "model-routing";

export const MODEL_ROUTE_TASKS = ["memory", "summaries"] as const;
export type ModelRouteTask = (typeof MODEL_ROUTE_TASKS)[number];

export const MODEL_ROUTE_TASK_LABELS: Record<ModelRouteTask, string> = {
  memory: "Memory",
  summaries: "Summaries",
};

export interface ModelRoutingSettings {
  version: 1;
  /** Task -> connection id. A missing task is not routed. */
  routes: Partial<Record<ModelRouteTask, string>>;
}

export const DEFAULT_MODEL_ROUTING_SETTINGS: ModelRoutingSettings = { version: 1, routes: {} };

export type ModelRouteProblem = "missing" | "disabled" | "not_text" | "no_model";

export type ModelRouteCheck = { ok: true; connection: JsonRecord } | { ok: false; problem: ModelRouteProblem };

function isModelRouteTask(value: string): value is ModelRouteTask {
  return (MODEL_ROUTE_TASKS as readonly string[]).includes(value);
}

export function normalizeModelRoutingSettings(value: unknown): ModelRoutingSettings {
  const routes: Partial<Record<ModelRouteTask, string>> = {};
  for (const [task, connectionId] of Object.entries(parseJsonObject(parseJsonObject(value).routes))) {
    const id = readString(connectionId).trim();
    if (isModelRouteTask(task) && id) routes[task] = id;
  }
  return { version: 1, routes };
}

export async function readModelRoutingSettings(storage: Pick<StorageGateway, "get">): Promise<ModelRoutingSettings> {
  const record = await storage.get<{ value?: unknown }>("app-settings", MODEL_ROUTING_SETTINGS_ID);
  return normalizeModelRoutingSettings(record?.value);
}

function localModelConnection(): JsonRecord {
  return {
    id: LOCAL_SIDECAR_CONNECTION_ID,
    name: "Local Model",
    provider: "sidecar",
    model: LOCAL_SIDECAR_MODEL,
    enabled: true,
  };
}

/** Whether `connectionId` can take routed helper work. */
export function checkModelRoute(connectionId: string, connections: readonly JsonRecord[]): ModelRouteCheck {
  const connection = connections.find((candidate) => readString(candidate.id).trim() === connectionId);
  if (!connection) {
    // The Local Model is not a stored connection; the runtime resolves it by id.
    return connectionId === LOCAL_SIDECAR_CONNECTION_ID
      ? { ok: true, connection: localModelConnection() }
      : { ok: false, problem: "missing" };
  }
  if (!boolish(connection.enabled, true)) return { ok: false, problem: "disabled" };
  if (readString(connection.provider).trim() === "image_generation") return { ok: false, problem: "not_text" };
  if (!readString(connection.model).trim()) return { ok: false, problem: "no_model" };
  return { ok: true, connection };
}

const FIX_HINT = 'Pick another connection, or "Same as today", in Connections → Helper Models.';

function problemText(problem: ModelRouteProblem, connectionName: string): string {
  switch (problem) {
    case "missing":
      return "is set to a connection that no longer exists.";
    case "disabled":
      return `is set to "${connectionName}", which is turned off.`;
    case "not_text":
      return `is set to "${connectionName}", which makes images, not text.`;
    case "no_model":
      return `is set to "${connectionName}", which has no model picked.`;
  }
}

/** One sentence naming the task and what is wrong with its route. */
export function modelRouteProblemSentence(
  task: ModelRouteTask,
  problem: ModelRouteProblem,
  connectionName: string,
): string {
  return `The ${MODEL_ROUTE_TASK_LABELS[task]} helper ${problemText(problem, connectionName)}`;
}

export class ModelRouteError extends Error {
  override name = "ModelRouteError";
  readonly code = "route_unavailable";

  constructor(
    readonly task: ModelRouteTask,
    readonly connectionId: string,
    readonly problem: ModelRouteProblem,
    connectionName: string,
  ) {
    super(`${modelRouteProblemSentence(task, problem, connectionName)} ${FIX_HINT}`);
  }
}

export function isModelRouteError(error: unknown): error is ModelRouteError {
  return error instanceof Error && error.name === "ModelRouteError";
}

/**
 * The connection routed for `task`, or null when the task is not routed (the
 * caller then picks its connection the way it did before routing existed).
 * Throws {@link ModelRouteError} when the route points at a connection that
 * cannot take the work.
 */
export function resolveModelRoute(
  task: ModelRouteTask,
  settings: ModelRoutingSettings,
  connections: readonly JsonRecord[],
): JsonRecord | null {
  const connectionId = settings.routes[task];
  if (!connectionId) return null;
  const check = checkModelRoute(connectionId, connections);
  if (check.ok) return check.connection;
  const named = connections.find((candidate) => readString(candidate.id).trim() === connectionId);
  throw new ModelRouteError(task, connectionId, check.problem, readString(named?.name).trim() || connectionId);
}

/** {@link resolveModelRoute} from stored settings; lists connections only when the task is routed. */
export async function resolveStoredModelRoute(
  storage: Pick<StorageGateway, "get" | "list">,
  task: ModelRouteTask,
): Promise<JsonRecord | null> {
  const settings = await readModelRoutingSettings(storage);
  if (!settings.routes[task]) return null;
  return resolveModelRoute(task, settings, await storage.list<JsonRecord>("connections"));
}
