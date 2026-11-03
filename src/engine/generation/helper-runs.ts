import type { StorageGateway } from "../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../contracts/types/sidecar";
import { parseJsonObject } from "../core/json";
import {
  MODEL_ROUTE_TASKS,
  MODEL_ROUTE_TASK_LABELS,
  isModelRouteError,
  resolveStoredModelRoute,
  type ModelRouteTask,
} from "./model-routing";
import { readString, type JsonRecord } from "./runtime-records";

/**
 * Helper run notes: the connection and model each background helper last ran on, and why that connection was picked,
 * or why the helper stopped. One app-settings row per task, so helpers running at the same moment never overwrite
 * each other, and both runtimes (this app and the hosted runner) write to the place Helper Models reads.
 */

/** Why a helper ran on its connection. */
export type HelperRunRule =
  /** The task's Helper Models route. */
  | "route"
  /** Picked for this one run (a hand-picked judge, a caller naming its connection). */
  | "picked"
  /** The fic's last judge, kept so scores stay comparable. */
  | "lastJudge"
  /** An agent's own connection (the Chat Summary agent for Summarize chat). */
  | "agent"
  /** The connection marked Default for Agents. */
  | "agentDefault"
  /** The chat's (or fic's) own connection. */
  | "chat"
  /** The connection marked as the app default. */
  | "appDefault"
  /** The first text connection, when nothing else was set. */
  | "first";

export interface HelperRun {
  version: 1;
  task: ModelRouteTask;
  /** The part of the task that ran, such as "story ledger" for Fanfic checks. Empty when the task has one part. */
  job: string;
  chatId: string | null;
  at: string;
  connectionId: string;
  connectionName: string;
  model: string;
  rule: HelperRunRule;
  /** Set when the helper stopped before calling a model (a broken or non-local route). */
  problem: string | null;
}

const HELPER_RUN_RULES: readonly HelperRunRule[] = [
  "route",
  "picked",
  "lastJudge",
  "agent",
  "agentDefault",
  "chat",
  "appDefault",
  "first",
];

export function helperRunSettingsId(task: ModelRouteTask): string {
  return `helper-run.${task}`;
}

type HelperRunStorage = Pick<StorageGateway, "get" | "create" | "update" | "updateAppSettingsIfUnchanged">;

/** Runs kept per task: the newest per job (a fic helper's step, a character read's character), newest first. */
export const HELPER_RUNS_PER_TASK = 12;
const WRITE_ATTEMPTS = 4;

export interface NoteHelperRunInput {
  task: ModelRouteTask;
  rule: HelperRunRule;
  connectionId: string;
  /** The connection record when the caller has it; otherwise it is read by id for its name and model. */
  connection?: JsonRecord | null;
  job?: string;
  chatId?: string | null;
  problem?: string | null;
  now?: () => Date;
}

async function connectionForNote(storage: HelperRunStorage, connectionId: string): Promise<JsonRecord | null> {
  if (!connectionId) return null;
  if (connectionId === LOCAL_SIDECAR_CONNECTION_ID) return { id: connectionId, name: "Local Model" };
  const stored = await storage.get<JsonRecord>("connections", connectionId);
  return stored && typeof stored === "object" ? stored : null;
}

function withRun(value: unknown, run: HelperRun): { version: 1; runs: HelperRun[] } {
  const kept = readHelperRunList(run.task, value).filter((entry) => entry.job !== run.job);
  return { version: 1, runs: [run, ...kept].slice(0, HELPER_RUNS_PER_TASK) };
}

/**
 * Puts `run` first in its task's row, replacing the same job's older run. The write is compare-and-set where the
 * runtime offers it, so two helpers of one task finishing together both keep their run.
 */
async function writeHelperRun(storage: HelperRunStorage, run: HelperRun): Promise<void> {
  const id = helperRunSettingsId(run.task);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const existing = await storage.get<{ value?: unknown }>("app-settings", id);
    if (!existing) {
      try {
        await storage.create("app-settings", { id, value: withRun(null, run) });
        return;
      } catch (error) {
        // Another helper of this task created the row first: add this run to theirs.
        if (await storage.get("app-settings", id)) continue;
        throw error;
      }
    }
    const next = withRun(existing.value, run);
    if (!storage.updateAppSettingsIfUnchanged) {
      await storage.update("app-settings", id, { value: next });
      return;
    }
    const { updated } = await storage.updateAppSettingsIfUnchanged(id, existing.value ?? null, next);
    if (updated) return;
  }
  throw new Error("the row kept changing while saving");
}

/**
 * Saves which connection a helper ran on and why. A note that can't be saved is logged and skipped: it is a
 * diagnostic, and the helper's own work must not fail over it.
 */
export async function noteHelperRun(storage: HelperRunStorage, input: NoteHelperRunInput): Promise<void> {
  try {
    const connectionId = input.connectionId.trim();
    const connection = input.connection ?? (await connectionForNote(storage, connectionId));
    await writeHelperRun(storage, {
      version: 1,
      task: input.task,
      job: (input.job ?? "").trim(),
      chatId: readString(input.chatId).trim() || null,
      at: (input.now?.() ?? new Date()).toISOString(),
      connectionId,
      connectionName: readString(connection?.name).trim() || connectionId,
      model: readString(connection?.model).trim(),
      rule: input.rule,
      problem: input.problem?.trim() || null,
    });
  } catch (error) {
    console.warn(`[helper-models] Couldn't save the ${MODEL_ROUTE_TASK_LABELS[input.task]} helper's last run.`, error);
  }
}

/**
 * {@link resolveStoredModelRoute} that also saves a broken route as the task's last run, so Helper Models can say why
 * the helper stopped. A working route is noted by the caller once it knows the connection it will use.
 */
export async function resolveHelperRoute(
  storage: Pick<StorageGateway, "get" | "list" | "create" | "update">,
  task: ModelRouteTask,
  context: { job?: string; chatId?: string | null } = {},
): Promise<JsonRecord | null> {
  try {
    return await resolveStoredModelRoute(storage, task);
  } catch (error) {
    if (isModelRouteError(error)) {
      await noteHelperRun(storage, {
        task,
        rule: "route",
        connectionId: error.connectionId,
        job: context.job,
        chatId: context.chatId,
        problem: error.message,
      });
    }
    throw error;
  }
}

/** For a helper that falls back to its chat's connection, then the app default, then the first connection. */
export function chatConnectionRule(connection: JsonRecord, ...chatConnectionIds: unknown[]): HelperRunRule {
  const id = readString(connection.id).trim();
  const ids = chatConnectionIds.map((candidate) => readString(candidate).trim());
  if (id && ids.includes(id)) return "chat";
  // A chat set to "random" ran on a connection from the random pool.
  if (ids.includes("random") && connection.useForRandom === true) return "chat";
  if (connection.isDefault === true || connection.default === true) return "appDefault";
  return "first";
}

function readHelperRun(task: ModelRouteTask, value: unknown): HelperRun | null {
  const record = parseJsonObject(value);
  const rule = readString(record.rule) as HelperRunRule;
  const at = readString(record.at);
  if (record.task !== task || !HELPER_RUN_RULES.includes(rule) || !at || Number.isNaN(Date.parse(at))) return null;
  return {
    version: 1,
    task,
    job: readString(record.job),
    chatId: readString(record.chatId) || null,
    at,
    connectionId: readString(record.connectionId),
    connectionName: readString(record.connectionName),
    model: readString(record.model),
    rule,
    problem: readString(record.problem) || null,
  };
}

function readHelperRunList(task: ModelRouteTask, value: unknown): HelperRun[] {
  const runs = parseJsonObject(value).runs;
  if (!Array.isArray(runs)) return [];
  return runs
    .map((entry) => readHelperRun(task, entry))
    .filter((run): run is HelperRun => run !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Each task's recent runs, newest first; a task that never ran is left out. */
export async function readHelperRuns(
  storage: Pick<StorageGateway, "get">,
): Promise<Partial<Record<ModelRouteTask, HelperRun[]>>> {
  const rows = await Promise.all(
    MODEL_ROUTE_TASKS.map(async (task) => {
      const row = await storage.get<{ value?: unknown }>("app-settings", helperRunSettingsId(task));
      return [task, row ? readHelperRunList(task, row.value) : []] as const;
    }),
  );
  const runs: Partial<Record<ModelRouteTask, HelperRun[]>> = {};
  for (const [task, list] of rows) if (list.length > 0) runs[task] = list;
  return runs;
}

/** The newest run of `task` for `job` in `chatId`, if there is one. */
export function findHelperRun(
  runs: Partial<Record<ModelRouteTask, HelperRun[]>> | undefined,
  task: ModelRouteTask,
  match: { job?: string; chatId?: string | null },
): HelperRun | null {
  return (
    runs?.[task]?.find(
      (run) =>
        (match.job === undefined || run.job === match.job) &&
        (match.chatId === undefined || run.chatId === match.chatId),
    ) ?? null
  );
}

/** The rule in words, for a sentence like "Ran on Cheap • small-model: <why>." */
export function helperRunWhy(run: Pick<HelperRun, "task" | "rule">): string {
  const label = MODEL_ROUTE_TASK_LABELS[run.task];
  const fic = run.task === "judge" || run.task === "fanficPlanning" || run.task === "fanficChecks";
  switch (run.rule) {
    case "route":
      return `your Helper Models pick for ${label}`;
    case "picked":
      return "picked for this run";
    case "lastJudge":
      return "this fic's last judge, so scores stay comparable";
    case "agent":
      return "the Chat Summary agent's own connection";
    case "agentDefault":
      return `Default for Agents (${label} has no Helper Models pick)`;
    case "chat":
      return fic
        ? `this fic's connection (${label} has no Helper Models pick)`
        : `the chat's connection (${label} has no Helper Models pick)`;
    case "appDefault":
      return "the default connection (nothing else was set)";
    case "first":
      return "the first text connection (nothing else was set)";
  }
}

/** One line for a helper's last run: where it ran and why, or why it stopped. */
export function describeHelperRun(run: HelperRun): string {
  const part = run.job ? ` (${run.job})` : "";
  if (run.problem) return `Stopped${part}: ${run.problem}`;
  const where = run.model ? `${run.connectionName} • ${run.model}` : run.connectionName;
  return `Ran${part} on ${where}: ${helperRunWhy(run)}.`;
}
