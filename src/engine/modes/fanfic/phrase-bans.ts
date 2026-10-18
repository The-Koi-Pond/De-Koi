// ──────────────────────────────────────────────
// Fanfic phrase bans for local models: backtrack and resample instead of filtering afterward
// ──────────────────────────────────────────────
// Banning tokens alone doesn't work (ban " breath" and a model writes " breathe"), so this follows Antislop (arXiv
// 2510.15061): find a banned phrase in the text, go back to just before it, resample a few tokens there with the
// phrase's opening banned at that position only, then carry on. That needs the model to continue a half-written reply
// (assistant prefill) and to take string logit biases, which llama.cpp's server does; hosted APIs mostly don't, so this
// only runs on local connections.
import type { LlmGateway, LlmMessage } from "../../capabilities/llm";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../contracts/types/sidecar";
import { readString, type JsonRecord } from "../../generation/runtime-records";
import { untilAborted } from "./llm-json";

/** Starting list: stock phrases from the AI-tell detector, as plain text the requester can edit. */
export const FANFIC_DEFAULT_BANNED_PHRASES = [
  "didn't know she was holding",
  "didn't know he was holding",
  "something shifted",
  "for a long moment",
  "in that moment",
  "couldn't help but",
  "the ghost of a smile",
  "a flicker of",
  "let out a breath",
  "released a breath",
  "despite himself",
  "despite herself",
  "palpable",
  "a testament to",
  "the air was thick with",
  "if she was being honest",
  "if he was being honest",
] as const;

export const FANFIC_BANNED_PHRASES_MAX = 60;
const PHRASE_MAX_CHARS = 80;
/** Tokens resampled with the ban in place before the model carries on freely. */
const RESAMPLE_TOKENS = 8;
const MAX_BACKTRACKS = 24;

/** Cleaned list: trimmed, lowercased, deduplicated, short enough to be a phrase. */
export function normalizeFanficBannedPhrases(raw: unknown): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const phrase = readString(entry)
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, PHRASE_MAX_CHARS);
    if (!phrase || !/[\p{L}\p{N}]/u.test(phrase) || seen.has(phrase)) continue;
    seen.add(phrase);
    phrases.push(phrase);
    if (phrases.length >= FANFIC_BANNED_PHRASES_MAX) break;
  }
  return phrases;
}

/** Whether this connection is a local llama.cpp-style server that can continue a reply and take string biases. */
export function fanficConnectionSupportsPhraseBans(connection: JsonRecord | null | undefined): boolean {
  if (!connection) return false;
  if (readString(connection.id) === LOCAL_SIDECAR_CONNECTION_ID) return true;
  if (readString(connection.provider) !== "custom") return false;
  try {
    const host = new URL(readString(connection.baseUrl)).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string): RegExp {
  const words = phrase.split(" ").map((word) => escapeRegex(word).replace(/'/g, "['’]"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

export interface FanficBannedHit {
  phrase: string;
  index: number;
  /** The text as it appears (case and apostrophes as written). */
  match: string;
}

/** Every banned phrase in the text, first one first. */
export function findFanficBannedPhrases(text: string, phrases: readonly string[]): FanficBannedHit[] {
  const hits: FanficBannedHit[] = [];
  for (const phrase of phrases) {
    for (const match of text.matchAll(phrasePattern(phrase))) {
      hits.push({ phrase, index: match.index ?? 0, match: match[0] });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Bias that forbids the phrase's first word at the next position, in the spellings a tokenizer might use. */
export function fanficPhraseOpeningBias(match: string): Record<string, number> {
  const first = match.split(/\s+/)[0] ?? "";
  const variants = new Set<string>();
  for (const word of [first, first.toLowerCase(), first.charAt(0).toUpperCase() + first.slice(1)]) {
    if (!word) continue;
    variants.add(word);
    variants.add(` ${word}`);
    variants.add(word.replace(/’/g, "'"));
    variants.add(` ${word.replace(/’/g, "'")}`);
  }
  return Object.fromEntries([...variants].map((variant) => [variant, -100]));
}

export interface FanficPhraseBanRequest {
  connectionId: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  /** Extra stop strings for every call (the resample and the continuation). */
  stop?: string[];
}

/** One call; with a prefill the reply is the whole message (prefix included) or just the continuation, depending on the server. */
async function continueFrom(
  llm: LlmGateway,
  request: FanficPhraseBanRequest,
  prefix: string,
  extra: { maxTokens: number; bias?: Record<string, number> },
  signal?: AbortSignal,
): Promise<string> {
  const parameters: Record<string, unknown> = { maxTokens: extra.maxTokens, temperature: request.temperature };
  if (prefix) parameters.assistantPrefill = prefix;
  if (extra.bias) parameters.customParameters = { logit_bias: extra.bias };
  if (request.stop?.length) parameters.stop = request.stop;
  const raw = await untilAborted(
    llm.complete({ connectionId: request.connectionId, messages: request.messages, parameters }, signal),
    signal,
  );
  if (!prefix) return raw;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

export interface FanficPhraseBanResult {
  text: string;
  /** Times a banned phrase was found and resampled. */
  backtracks: number;
  /** Banned phrases still in the text (the resample kept landing on one, or the budget ran out). */
  remaining: FanficBannedHit[];
}

/**
 * Generates (or, given `start`, continues repairing) text with phrase bans: each time a banned phrase shows up, the text
 * is cut back to just before it, a few tokens are resampled there with its first word banned, and the model carries
 * on from that new prefix to the end. Whatever came after the phrase is regenerated, the way Antislop does it during
 * sampling.
 */
export async function completeWithFanficPhraseBans(
  llm: LlmGateway,
  request: FanficPhraseBanRequest,
  phrases: readonly string[],
  options: { signal?: AbortSignal; start?: string; maxBacktracks?: number } = {},
): Promise<FanficPhraseBanResult> {
  const { signal } = options;
  let text = options.start ?? (await continueFrom(llm, request, "", { maxTokens: request.maxTokens }, signal));
  let backtracks = 0;
  const limit = options.maxBacktracks ?? MAX_BACKTRACKS;
  for (;;) {
    const hit = findFanficBannedPhrases(text, phrases)[0];
    if (!hit || backtracks >= limit) break;
    backtracks += 1;
    const prefix = text.slice(0, hit.index);
    const step = await continueFrom(
      llm,
      request,
      prefix,
      { maxTokens: RESAMPLE_TOKENS, bias: fanficPhraseOpeningBias(hit.match) },
      signal,
    );
    if (!step.trim()) break;
    const rest = await continueFrom(llm, request, prefix + step, { maxTokens: request.maxTokens }, signal);
    text = prefix + step + rest;
  }
  return { text, backtracks, remaining: findFanficBannedPhrases(text, phrases) };
}

const SENTENCE_END = /[.!?…]+["”’)]*(?=\s|$)/g;

/** Where the sentence holding `from` ends (just past its closing punctuation), or the text's end. */
function sentenceEnd(text: string, from: number): number {
  SENTENCE_END.lastIndex = from;
  const match = SENTENCE_END.exec(text);
  return match ? match.index + match[0].length : text.length;
}

/**
 * Takes the banned phrases out of finished text one sentence at a time: back up to the phrase, resample with its
 * opening banned, let the model finish that sentence, and keep the original text from the next sentence on. The
 * request is the chapter's own prompt, so the new words fit what's around them.
 */
export async function repairFanficBannedPhrases(
  llm: LlmGateway,
  request: FanficPhraseBanRequest,
  text: string,
  phrases: readonly string[],
  options: { signal?: AbortSignal; maxRepairs?: number } = {},
): Promise<FanficPhraseBanResult & { repaired: number }> {
  let current = text;
  let repaired = 0;
  let attempts = 0;
  const limit = options.maxRepairs ?? MAX_BACKTRACKS;
  // Hits the resample couldn't avoid are skipped from then on, so one stubborn phrase doesn't stop the rest.
  let floor = 0;
  for (;;) {
    const hit = findFanficBannedPhrases(current, phrases).find((entry) => entry.index >= floor);
    if (!hit || attempts >= limit) break;
    attempts += 1;
    const prefix = current.slice(0, hit.index);
    const end = sentenceEnd(current, hit.index + hit.match.length);
    const step = await continueFrom(
      llm,
      request,
      prefix,
      { maxTokens: RESAMPLE_TOKENS, bias: fanficPhraseOpeningBias(hit.match) },
      options.signal,
    );
    const finish = step.trim()
      ? await continueFrom(llm, request, prefix + step, { maxTokens: 80 }, options.signal)
      : "";
    const fresh = step + finish;
    const cut = sentenceEnd(fresh, 0);
    const tail = fresh.slice(0, cut);
    const replaced = `${prefix}${tail}${current.slice(end)}`;
    if (!tail.trim() || findFanficBannedPhrases(tail, phrases).length > 0) {
      floor = end;
      continue;
    }
    current = replaced;
    repaired += 1;
    floor = prefix.length + tail.length;
  }
  return { text: current, backtracks: attempts, repaired, remaining: findFanficBannedPhrases(current, phrases) };
}
