// ──────────────────────────────────────────────
// The chat something new is made from: which model reads it, and how much of it fits
// ──────────────────────────────────────────────
import type { StorageGateway } from "../../capabilities/storage";
import { resolveBackgroundTextConnection } from "../../generation/background-llm-connection";
import { effectiveMaxContext } from "../../generation/context-window";
import { loadConnectionRow } from "../../generation/helper-connection";
import { readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../user-facing-error";

const NO_CONNECTION = "Add a model connection first, then try again.";

const TRANSCRIPT_DEFAULT_CHARS = 40_000;
const TRANSCRIPT_MAX_CHARS = 60_000;
const TRANSCRIPT_MIN_CHARS = 2_000;
const CHARS_PER_TOKEN = 3;
/** Room kept for the instructions and the character cards around the transcript. */
const FRAME_TOKENS = 3_000;

/** The source chat's own model, else the app's default text model. */
export async function sourceConnectionId(storage: StorageGateway, chat: JsonRecord): Promise<string> {
  const own = readString(chat.connectionId).trim();
  if (own && (await loadConnectionRow(storage, own))) return own;
  const fallback = await resolveBackgroundTextConnection(storage).catch(() => null);
  const id = readString(fallback?.id).trim();
  if (!id) throw userFacingError(NO_CONNECTION);
  return id;
}

/** How much of a source transcript fits beside a call on this connection that may reply with up to `replyTokens`. */
export async function sourceTranscriptBudget(
  storage: StorageGateway,
  connectionId: string,
  replyTokens: number,
): Promise<number> {
  const connection = await loadConnectionRow(storage, connectionId);
  const window = connection ? effectiveMaxContext(connection, {}) : 0;
  if (!(window > 0)) return TRANSCRIPT_DEFAULT_CHARS;
  const chars = (window - replyTokens - FRAME_TOKENS) * CHARS_PER_TOKEN;
  if (chars < TRANSCRIPT_MIN_CHARS) {
    throw userFacingError("This model's context is too small to read the chat. Pick a model with a larger context.");
  }
  return Math.min(TRANSCRIPT_MAX_CHARS, chars);
}
