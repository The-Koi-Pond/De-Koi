// ──────────────────────────────────────────────
// Fanfic helper calls: one-shot model requests that reply in JSON
// ──────────────────────────────────────────────
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import { extractLeadingThinkingBlocks } from "../../generation-core/llm/inline-thinking";
import { isRecord, type JsonRecord } from "../../generation/runtime-records";
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

/**
 * How much story text one helper call can carry in a connection's context window, after the reply and the fixed
 * instructions. Counts about 3 characters a token to stay on the safe side. An unknown window (0) gets the defaults.
 */
export function fanficCallBudget(
  window: number,
  options: { maxReplyTokens: number; overheadTokens: number; defaultChars: number; maxChars?: number },
): FanficCallBudget {
  if (!(window > 0)) return { replyTokens: options.maxReplyTokens, proseChars: options.defaultChars };
  const replyTokens = Math.min(options.maxReplyTokens, Math.max(512, Math.floor(window / 4)));
  const proseChars = Math.max(0, (window - replyTokens - options.overheadTokens) * 3);
  return { replyTokens, proseChars: Math.min(options.maxChars ?? Infinity, proseChars) };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Settles as soon as the signal aborts, even when the gateway ignores it (the app gateway's complete() can't cancel a
 * request already sent), so Stop ends the work right away and the late reply is dropped.
 */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
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
