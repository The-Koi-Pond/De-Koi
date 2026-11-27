// The connection a background helper runs on, picked the same way for every mode that has one.
import type { StorageGateway } from "../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import { userFacingError } from "../shared/user-facing-error";
import { noteHelperRun, resolveHelperRoute, type HelperRunRule } from "./helper-runs";
import {
  assertLocalOnlyConnection,
  isModelRouteError,
  readModelRoutingSettings,
  type ModelRouteTask,
} from "./model-routing";
import { isRecord, readString, type JsonRecord } from "./runtime-records";

/**
 * A connection's stored row, or the built-in local model's synthetic one (it isn't stored; the server resolves it at
 * call time). Its window isn't known here, so callers size its calls with their defaults.
 */
export async function loadConnectionRow(storage: StorageGateway, connectionId: string): Promise<JsonRecord | null> {
  const stored = await storage.get("connections", connectionId);
  if (isRecord(stored)) return stored;
  if (connectionId !== LOCAL_SIDECAR_CONNECTION_ID) return null;
  return { id: LOCAL_SIDECAR_CONNECTION_ID, name: "Local Model", provider: "sidecar", model: LOCAL_SIDECAR_MODEL };
}

const NO_CONNECTION = Symbol("helperNoConnection");

/** The owner has no connection for this helper (and the helper has no route); see {@link pickHelperConnection}. */
export function isNoHelperConnectionError(error: unknown): boolean {
  return error instanceof Error && (error as { [NO_CONNECTION]?: true })[NO_CONNECTION] === true;
}

export interface HelperPick {
  connectionId: string;
  /** Null only for an owner set to the random pool, which the server resolves per call. */
  connection: JsonRecord | null;
  rule: HelperRunRule;
}

export interface PickHelperInput {
  /** The chat the run belongs to, for the run note; null before the chat exists (a campaign being built). */
  chatId?: string | null;
  /** Named for this one run (a pick made in setup, a later step reusing an earlier step's pick); outranks the route. */
  connectionId?: string | null;
  /** The part of the task, for the run note: "outline", "story ledger", ... */
  job: string;
  /** Said when the owner has no connection. */
  missing: string;
  /** Said when the picked connection was deleted. */
  gone: string;
  /** Let an owner set to the random pool run this helper there. */
  allowRandom?: boolean;
  /** False when the caller may still skip the model call: it then notes the run itself with {@link noteHelperPick}. */
  note?: boolean;
}

/**
 * The connection a helper runs on: one named for this run, else the task's Helper Models route, else the owner's own
 * connection (`owner.connectionId`: the fic, the chat, or the story model a campaign is being built for). Notes the
 * pick, or why the helper stopped, as the task's last run.
 */
export async function pickHelperConnection(
  storage: StorageGateway,
  task: ModelRouteTask,
  owner: JsonRecord,
  input: PickHelperInput,
): Promise<HelperPick> {
  const context = { job: input.job, chatId: input.chatId };
  const picked = readString(input.connectionId).trim();
  let pick: HelperPick;
  if (picked) {
    const connection = await loadConnectionRow(storage, picked);
    if (!connection) throw userFacingError(input.gone);
    try {
      // A pick for this run outranks the route, but a local-only helper still stays local.
      assertLocalOnlyConnection(task, await readModelRoutingSettings(storage), picked, connection);
    } catch (error) {
      if (isModelRouteError(error)) {
        await noteHelperRun(storage, {
          task,
          ...context,
          rule: "picked",
          connectionId: picked,
          connection,
          problem: error.message,
        });
      }
      throw error;
    }
    pick = { connectionId: picked, connection, rule: "picked" };
  } else {
    const routed = await resolveHelperRoute(storage, task, context);
    if (routed) {
      pick = { connectionId: readString(routed.id).trim(), connection: routed, rule: "route" };
    } else {
      const own = readString(owner.connectionId).trim();
      if (!own || (own === "random" && !input.allowRandom)) {
        throw Object.assign(userFacingError(input.missing), { [NO_CONNECTION]: true as const });
      }
      const connection = own === "random" ? null : await loadConnectionRow(storage, own);
      if (own !== "random" && !connection) throw userFacingError(input.gone);
      pick = { connectionId: own, connection, rule: "chat" };
    }
  }
  if (input.note !== false) await noteHelperPick(storage, task, input, pick);
  return pick;
}

/** Notes a helper's pick as the task's last run. */
export function noteHelperPick(
  storage: StorageGateway,
  task: ModelRouteTask,
  input: Pick<PickHelperInput, "chatId" | "job">,
  pick: HelperPick,
): Promise<void> {
  return noteHelperRun(storage, {
    task,
    job: input.job,
    chatId: input.chatId,
    rule: pick.rule,
    connectionId: pick.connectionId,
    connection: pick.connection,
  });
}
