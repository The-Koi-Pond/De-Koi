import type { StorageGateway } from "../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import { parseJsonObject } from "../core/json";
import { boolish, readString, type JsonRecord } from "./runtime-records";

/**
 * Helper Models: send a class of background helper work to one chosen
 * connection. A task without a route keeps the connection it used before
 * routing existed, so nothing changes until the user picks a route. A routed
 * task never falls back: a broken route throws {@link ModelRouteError}.
 *
 * A task marked local-only must run on a connection on this device or network.
 * It stops instead of sending its input anywhere else, routed or not.
 */

export const MODEL_ROUTING_SETTINGS_ID = "model-routing";

export const MODEL_ROUTE_TASKS = [
  "memory",
  "summaries",
  "habitCheck",
  "judge",
  "responder",
  "status",
  "schedules",
  "interpretations",
  "fanficPlanning",
  "fanficChecks",
] as const;
export type ModelRouteTask = (typeof MODEL_ROUTE_TASKS)[number];

export const MODEL_ROUTE_TASK_LABELS: Record<ModelRouteTask, string> = {
  memory: "Memory",
  summaries: "Summaries",
  habitCheck: "Habit check",
  judge: "Fanfic judge",
  responder: "Group responder",
  status: "Status blurbs",
  schedules: "Schedules",
  interpretations: "Character reads",
  fanficPlanning: "Fanfic planning",
  fanficChecks: "Fanfic checks",
};

export interface ModelRoutingSettings {
  version: 1;
  /** Task -> connection id. A missing task is not routed. */
  routes: Partial<Record<ModelRouteTask, string>>;
  /** Tasks that must stay on this device or network. Omitted when empty. */
  localOnly?: ModelRouteTask[];
}

export const DEFAULT_MODEL_ROUTING_SETTINGS: ModelRoutingSettings = { version: 1, routes: {} };

export type ModelRouteProblem = "missing" | "disabled" | "not_text" | "no_model" | "not_local" | "no_local_route";

export type ModelRouteCheck = { ok: true; connection: JsonRecord } | { ok: false; problem: ModelRouteProblem };

function isModelRouteTask(value: string): value is ModelRouteTask {
  return (MODEL_ROUTE_TASKS as readonly string[]).includes(value);
}

export function normalizeModelRoutingSettings(value: unknown): ModelRoutingSettings {
  const record = parseJsonObject(value);
  const routes: Partial<Record<ModelRouteTask, string>> = {};
  for (const [task, connectionId] of Object.entries(parseJsonObject(record.routes))) {
    const id = readString(connectionId).trim();
    if (isModelRouteTask(task) && id) routes[task] = id;
  }
  const marked = Array.isArray(record.localOnly) ? record.localOnly.map((entry) => readString(entry).trim()) : [];
  const localOnly = MODEL_ROUTE_TASKS.filter((task) => marked.includes(task));
  return localOnly.length > 0 ? { version: 1, routes, localOnly } : { version: 1, routes };
}

export async function readModelRoutingSettings(storage: Pick<StorageGateway, "get">): Promise<ModelRoutingSettings> {
  const record = await storage.get<{ value?: unknown }>("app-settings", MODEL_ROUTING_SETTINGS_ID);
  return normalizeModelRoutingSettings(record?.value);
}

function isLocalOnlyTask(task: ModelRouteTask, settings: ModelRoutingSettings): boolean {
  return settings.localOnly?.includes(task) ?? false;
}

// Name endings that only resolve on this device or a home/office network.
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home.arpa"];

function isLocalIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const [a = -1, b = -1] = host.split(".").map(Number);
  return (
    a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  );
}

function isLocalIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (!bare.includes(":")) return false;
  if (bare === "::1") return true;
  // Unique local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd][0-9a-f]{0,2}:/.test(bare) || /^fe[89ab][0-9a-f]?:/.test(bare);
}

/**
 * Whether requests to `connection` stay on this device or local network: the Local Model, or a base
 * URL on loopback, a private LAN address, a local-only name ending, or a one-word host name such as
 * `ollama` or `pi`. A blank base URL goes to the provider's cloud API. A local proxy that forwards to
 * the cloud still looks local; nothing here can see past it.
 */
export function isLocalConnection(connection: JsonRecord): boolean {
  const provider = readString(connection.provider).trim();
  if (provider === "sidecar" || readString(connection.id).trim() === LOCAL_SIDECAR_CONNECTION_ID) return true;
  // These sign in to a vendor account and ignore the base URL.
  if (provider === "openai_chatgpt" || provider === "claude_subscription") return false;
  const baseUrl = readString(connection.baseUrl).trim();
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isLocalIpv4(host) || isLocalIpv6(host)) return true;
  return !host.includes(".") && !host.includes(":");
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

/** Whether `connectionId` can take routed helper work (and, for a local-only task, keeps it local). */
export function checkModelRoute(
  connectionId: string,
  connections: readonly JsonRecord[],
  options: { localOnly?: boolean } = {},
): ModelRouteCheck {
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
  if (options.localOnly && !isLocalConnection(connection)) return { ok: false, problem: "not_local" };
  return { ok: true, connection };
}

const FIX_HINT = 'Pick another connection, or "Same as today", in Connections → Helper Models.';
const LOCAL_FIX_HINT =
  'Pick a connection on this device or network, or turn off "Keep on my device", in Connections → Helper Models.';

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
    case "not_local":
      return `must stay on your device, but "${connectionName}" sends work off it.`;
    case "no_local_route":
      return "must stay on your device, but has no connection on your device picked.";
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
    const hint = problem === "not_local" || problem === "no_local_route" ? LOCAL_FIX_HINT : FIX_HINT;
    super(`${modelRouteProblemSentence(task, problem, connectionName)} ${hint}`);
  }
}

export function isModelRouteError(error: unknown): error is ModelRouteError {
  return error instanceof Error && error.name === "ModelRouteError";
}

/**
 * The connection routed for `task`, or null when the task is not routed (the
 * caller then picks its connection the way it did before routing existed).
 * Throws {@link ModelRouteError} when the route points at a connection that
 * cannot take the work, or when a local-only task has no local route.
 */
export function resolveModelRoute(
  task: ModelRouteTask,
  settings: ModelRoutingSettings,
  connections: readonly JsonRecord[],
): JsonRecord | null {
  const connectionId = settings.routes[task];
  const localOnly = isLocalOnlyTask(task, settings);
  if (!connectionId) {
    // Unrouted work would use its old pick, which may not be local.
    if (localOnly) throw new ModelRouteError(task, "", "no_local_route", "");
    return null;
  }
  const check = checkModelRoute(connectionId, connections, { localOnly });
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
  if (!settings.routes[task] && !isLocalOnlyTask(task, settings)) return null;
  return resolveModelRoute(task, settings, await storage.list<JsonRecord>("connections"));
}

/**
 * For the call sites where a pick outranks the route (an agent's own connection, a fic's last
 * judge, a judge picked by hand): stops a local-only task on a connection that is not local.
 */
export function assertLocalOnlyConnection(
  task: ModelRouteTask,
  settings: ModelRoutingSettings,
  connectionId: string,
  connection: JsonRecord | null | undefined,
): void {
  if (!isLocalOnlyTask(task, settings)) return;
  if (connection ? isLocalConnection(connection) : connectionId === LOCAL_SIDECAR_CONNECTION_ID) return;
  throw new ModelRouteError(task, connectionId, "not_local", readString(connection?.name).trim() || connectionId);
}
