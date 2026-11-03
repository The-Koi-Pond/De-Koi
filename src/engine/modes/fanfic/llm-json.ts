// ──────────────────────────────────────────────
// Fanfic helper calls: one-shot model requests that reply in JSON
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import type { StorageGateway } from "../../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../../contracts/types/sidecar";
import { noteHelperRun, resolveHelperRoute, type HelperRunRule } from "../../generation/helper-runs";
import {
  assertLocalOnlyConnection,
  isModelRouteError,
  readModelRoutingSettings,
  type ModelRouteTask,
} from "../../generation/model-routing";
import { isRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { parseGameJsonish } from "../../shared/parsing-jsonish";

/** The reply didn't follow the requested format; worth one more try rather than failing outright. */
export class FanficReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FanficReplyParseError";
  }
}

export function cleanFanficReply(raw: string): string {
  return extractLeadingThinkingBlocks(raw).cleanText;
}

function jsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** The JSON object in a reply (fenced or bare), or null. */
export function parseFanficJsonReply(raw: string): JsonRecord | null {
  try {
    const parsed = parseGameJsonish(jsonCandidate(cleanFanficReply(raw)));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface FanficCallBudget {
  /** Reply tokens to ask for: the job's cap, or a quarter of a small window. */
  replyTokens: number;
  /** Characters of story text that fit beside the instructions and the reply. */
  proseChars: number;
}

/** Characters per token when sizing prompts: on the low side, so estimates err toward fitting. */
const CHARS_PER_TOKEN = 3;
/** Below this there's no room for a useful reply. */
const MIN_REPLY_TOKENS = 256;

/** The connection's window can't hold the instructions, the text that must go in, and a reply. */
export class FanficWindowTooSmallError extends Error {
  constructor(what: string) {
    super(`This connection's context window is too small for ${what}. Pick a connection with a larger window.`);
    this.name = "FanficWindowTooSmallError";
  }
}

/**
 * How much more story text one helper call can carry in a connection's window, after the prompt text that always goes
 * in (`fixedChars`, measured from the real prompt) and the reply. The reply gets the job's cap or a quarter of the
 * window, whichever is smaller, and never more than what's left. Throws when even the fixed text and a minimal reply
 * don't fit. An unknown window (0) gets the defaults.
 */
export function fanficCallBudget(
  window: number,
  options: { maxReplyTokens: number; fixedChars: number; defaultChars: number; maxChars?: number; what: string },
): FanficCallBudget {
  if (!(window > 0)) return { replyTokens: options.maxReplyTokens, proseChars: options.defaultChars };
  const free = window - Math.ceil(options.fixedChars / CHARS_PER_TOKEN);
  const replyTokens = Math.min(options.maxReplyTokens, Math.floor(window / 4), free);
  if (replyTokens < MIN_REPLY_TOKENS) throw new FanficWindowTooSmallError(options.what);
  const proseChars = Math.max(0, (free - replyTokens) * CHARS_PER_TOKEN);
  return { replyTokens, proseChars: Math.min(options.maxChars ?? Infinity, proseChars) };
}

/** Total characters across a call's messages. */
export function fanficMessageChars(messages: readonly LlmMessage[]): number {
  return messages.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Settles as soon as the signal aborts, even when the gateway ignores it (the app gateway's complete() can't cancel a
 * request already sent), so Stop ends the work right away and the late reply is dropped.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * One model call at temperature 0, parsed by `parse`. A reply that breaks the format (FanficReplyParseError) gets one
 * retry: models occasionally drift from a reply format, and the whole job shouldn't fail on that.
 */
export async function completeFanficJson<T>(
  llm: LlmGateway,
  request: { connectionId: string; messages: LlmMessage[]; maxTokens: number },
  parse: (raw: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const raw = await untilAborted(
      llm.complete(
        {
          connectionId: request.connectionId,
          messages: request.messages,
          parameters: { maxTokens: request.maxTokens, temperature: 0 },
        },
        signal,
      ),
      signal,
    );
    try {
      return parse(raw);
    } catch (error) {
      if (attempt >= 1 || !(error instanceof FanficReplyParseError)) throw error;
    }
  }
}

/**
 * The connection a fanfic helper call runs on: the stored one, or the built-in local model, which isn't stored (the
 * server resolves it at call time). Its window isn't known here, so helpers size its calls with the defaults.
 */
export async function loadFanficConnection(storage: StorageGateway, connectionId: string): Promise<JsonRecord | null> {
  const stored = await storage.get("connections", connectionId);
  if (isRecord(stored)) return stored;
  if (connectionId !== LOCAL_SIDECAR_CONNECTION_ID) return null;
  return { id: LOCAL_SIDECAR_CONNECTION_ID, name: "Local Model", provider: "sidecar", model: LOCAL_SIDECAR_MODEL };
}

export const FANFIC_NO_CONNECTION = "Pick a connection for this fic first.";
export const FANFIC_CONNECTION_GONE = "That connection no longer exists. Pick another connection for this fic.";

const NO_CONNECTION = Symbol("fanficNoConnection");

/** The fic has no connection for this helper (and the helper has no route); see {@link pickFanficHelperConnection}. */
export function isFanficNoConnectionError(error: unknown): boolean {
  return error instanceof Error && (error as { [NO_CONNECTION]?: true })[NO_CONNECTION] === true;
}

export type FanficHelperTask = Extract<ModelRouteTask, "fanficPlanning" | "fanficChecks">;

export interface FanficHelperPick {
  connectionId: string;
  /** Null only for a fic set to the random pool, which the server resolves per call. */
  connection: JsonRecord | null;
  rule: HelperRunRule;
}

export interface PickFanficHelperInput {
  chatId: string;
  /** Named for this one run (a lab script, a later step reusing an earlier step's pick); outranks the route. */
  connectionId?: string | null;
  /** The part of the task, for the run note: "outline", "story ledger", ... */
  job: string;
  /** Said when the fic has no connection. */
  missing: string;
  /** Said when the picked connection was deleted. */
  gone: string;
  /** Let a fic set to the random pool run this helper there, as it did before routing. */
  allowRandom?: boolean;
  /** False when the caller may still skip the model call: it then notes the run itself with {@link noteFanficHelperRun}. */
  note?: boolean;
}

/**
 * The connection a fanfic helper runs on: one named for this run, else the task's Helper Models route, else the fic's
 * own connection. The chapter writer never comes here; it stays on the fic's connection. Notes the pick, or why the
 * helper stopped, as the task's last run.
 */
export async function pickFanficHelperConnection(
  storage: StorageGateway,
  task: FanficHelperTask,
  chat: JsonRecord,
  input: PickFanficHelperInput,
): Promise<FanficHelperPick> {
  const context = { job: input.job, chatId: input.chatId };
  const picked = readString(input.connectionId).trim();
  let pick: FanficHelperPick;
  if (picked) {
    const connection = await loadFanficConnection(storage, picked);
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
      const fic = readString(chat.connectionId).trim();
      if (!fic || (fic === "random" && !input.allowRandom)) {
        throw Object.assign(userFacingError(input.missing), { [NO_CONNECTION]: true as const });
      }
      const connection = fic === "random" ? null : await loadFanficConnection(storage, fic);
      if (fic !== "random" && !connection) throw userFacingError(input.gone);
      pick = { connectionId: fic, connection, rule: "chat" };
    }
  }
  if (input.note !== false) await noteFanficHelperRun(storage, task, input, pick);
  return pick;
}

/** Notes a fanfic helper's pick as the task's last run. */
export function noteFanficHelperRun(
  storage: StorageGateway,
  task: FanficHelperTask,
  input: Pick<PickFanficHelperInput, "chatId" | "job">,
  pick: FanficHelperPick,
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
