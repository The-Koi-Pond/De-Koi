// ──────────────────────────────────────────────
// Fanfic chapter versions: which models wrote each version, and how it was made
// ──────────────────────────────────────────────
import {
  FANFIC_UNFINISHED_REASONS,
  FANFIC_VERSION_ORIGIN_KINDS,
  type FanficModelRecord,
  type FanficUnfinished,
  type FanficUnfinishedReason,
  type FanficVersion,
  type FanficVersionOriginKind,
} from "../../contracts/types/fanfic";
import {
  isRecord,
  parseRecord,
  readNonNegativeInteger,
  readString,
  type JsonRecord,
} from "../../generation/runtime-records";

const isString = (value: unknown): value is string => typeof value === "string";

function readModelRecord(value: unknown): FanficModelRecord | null {
  if (!isRecord(value) || !isString(value.connectionId) || !value.connectionId.trim()) return null;
  if (!isString(value.name) || !isString(value.model) || !(value.name.trim() || value.model.trim())) return null;
  return { connectionId: value.connectionId, name: value.name, model: value.model };
}

/** An origin that can't be read is unknown, never a guess: it would pick the wrong Reset box and follow-ups. */
function readOrigin(value: unknown): FanficVersion["origin"] {
  const origin = parseRecord(value);
  const kind = FANFIC_VERSION_ORIGIN_KINDS.includes(origin.kind as FanficVersionOriginKind)
    ? (origin.kind as FanficVersionOriginKind)
    : null;
  if (!kind || !isString(origin.notes)) return null;
  const baseVersion = origin.baseVersion;
  return Number.isInteger(baseVersion) && (baseVersion as number) >= 0
    ? { kind, notes: origin.notes, baseVersion: baseVersion as number }
    : { kind, notes: origin.notes };
}

/** An unreadable reason still marks the version unfinished: a cut chapter must never read as finished. */
function readUnfinished(value: unknown): FanficUnfinished | null {
  if (!isRecord(value)) return null;
  const reason = FANFIC_UNFINISHED_REASONS.includes(value.reason as FanficUnfinishedReason)
    ? (value.reason as FanficUnfinishedReason)
    : "failure";
  return {
    reason,
    message: isString(value.message) ? value.message : null,
    code: isString(value.code) ? value.code : null,
  };
}

/** The version record on one swipe's extra, or null for a version written before records were kept. */
export function readFanficVersion(extra: unknown): FanficVersion | null {
  const raw = parseRecord(extra).fanficVersion;
  if (!isRecord(raw)) return null;
  const models = Array.isArray(raw.models)
    ? raw.models.map(readModelRecord).filter((record): record is FanficModelRecord => record !== null)
    : [];
  return { models, origin: readOrigin(raw.origin), unfinished: readUnfinished(raw.unfinished) };
}

/** A connection's record for text it writes: its id, and its name and model id as it shows them now. */
export function fanficModelRecord(connection: JsonRecord): FanficModelRecord {
  return {
    connectionId: readString(connection.id),
    name: readString(connection.name).trim(),
    model: readString(connection.model).trim(),
  };
}

/** Which stored version of a chapter message is on screen. */
export function fanficVersionIndex(message: JsonRecord): number {
  return readNonNegativeInteger(message.activeSwipeIndex, 0);
}

/** The models after `record` wrote another part: added unless the same connection and model wrote the last part. */
export function fanficModelsWith(models: readonly FanficModelRecord[], record: FanficModelRecord): FanficModelRecord[] {
  const last = models.at(-1);
  const same = last?.connectionId === record.connectionId && last.model === record.model;
  return same ? [...models] : [...models, record];
}

/**
 * A version made by changing part of another one: the source version's models, then the model that wrote the change.
 * A source written before models were recorded adds none.
 */
export function fanficRewrittenVersion(source: JsonRecord, rewriter: FanficModelRecord, notes: string): FanficVersion {
  return {
    models: fanficModelsWith(readFanficVersion(source.extra)?.models ?? [], rewriter),
    origin: { kind: "revise", notes: notes.trim(), baseVersion: fanficVersionIndex(source) },
    unfinished: null,
  };
}

const PROVIDER_RESET_CODES = new Set(["llm_stream_text_reset", "claude_subscription_stream_replaced"]);
const GEMINI_BLOCKED_FINISHES = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

function classifyFailure(cause: unknown): FanficUnfinished {
  const error = parseRecord(cause);
  const details = parseRecord(error.details);
  const code = readString(error.code || details.code).trim() || null;
  const message = readString(error.message).trim() || null;
  const unfinished = (reason: FanficUnfinishedReason): FanficUnfinished => ({ reason, code, message });
  // OpenAI Responses reports why an incomplete response stopped; Gemini reports its blocked finish.
  const incompleteReason = readString(parseRecord(parseRecord(details.response).incomplete_details).reason);
  if (code && PROVIDER_RESET_CODES.has(code)) return unfinished("provider_reset");
  if (GEMINI_BLOCKED_FINISHES.has(readString(details.finishReason).trim().toUpperCase())) {
    return unfinished("content_filter");
  }
  if (incompleteReason === "content_filter") return unfinished("content_filter");
  if (code === "llm_stream_length" || incompleteReason === "max_output_tokens") return unfinished("length");
  return unfinished("failure");
}

/**
 * Why a chapter write stopped early: from the error it ended with, or, for a reply that ended normally, from the
 * provider's stop reason. Null when the chapter finished. An OpenAI-compatible length stop already arrives as an error.
 */
export function classifyFanficInterruption(cause: unknown, providerMetadata: unknown): FanficUnfinished | null {
  if (cause != null) return classifyFailure(cause);
  const metadata = parseRecord(providerMetadata);
  const finishReason = readString(metadata.finishReason).trim();
  const stopReason = readString(metadata.stopReason).trim();
  if (finishReason === "content_filter") return { reason: "content_filter", code: finishReason, message: null };
  if (stopReason === "refusal") return { reason: "content_filter", code: stopReason, message: null };
  if (stopReason === "max_tokens" || stopReason === "MAX_TOKENS") {
    return { reason: "length", code: stopReason, message: null };
  }
  return null;
}

/** "Writer • big-model → Drafter • small-model": each run of one model once, in writing order; null with none. */
export function fanficModelLabel(records: readonly FanficModelRecord[]): string | null {
  const runs = records.filter(
    (record, index) =>
      index === 0 ||
      record.connectionId !== records[index - 1]!.connectionId ||
      record.model !== records[index - 1]!.model,
  );
  if (runs.length === 0) return null;
  return runs.map((record) => [record.name.trim(), record.model.trim()].filter(Boolean).join(" • ")).join(" → ");
}
