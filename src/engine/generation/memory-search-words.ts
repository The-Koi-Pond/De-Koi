import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { noteHelperRun, resolveHelperRoute } from "./helper-runs";
import { readString } from "./runtime-records";

/**
 * Memory search words: before a reply, a small helper call lists the words a saved memory about the user's message
 * would likely contain (names, objects, places, synonyms). Memory recall, canonical memories and Story Continuity
 * add them to their keyword match, so "what I lent you back at the lock" can find "Cass gave Odile the oilskin coat".
 * Without an embedding model, recall only matches shared words; in the long-chat lab (#1708) this took questions that
 * share no words with the fact from 15/72 to 36/72 reaching the prompt, with keyword questions also up (61 to 71/72).
 *
 * The call starts as the turn starts and runs alongside saving the message and loading history. Prompt assembly
 * waits for it only until {@link MEMORY_SEARCH_WORDS_WAIT_MS} after the start; a late answer is dropped and the
 * search uses the message alone, as before. It runs only when the Helper Models Memory route is set: the reply
 * reaches the memory search about 0.25 s after the turn starts, so the wait is almost all added time, and the usual
 * fallback (the reply's own connection) answered in 4-5 s on the Pi, never in time (2026-11-17). It is also skipped
 * on Claude Subscription (too slow; see SLOW_PROVIDER), and a route that answers too late several replies in a row is
 * skipped for a while (see LATE_STREAK_TO_SKIP), so a slow helper doesn't cost a cancelled call on every reply.
 */

/** Longest the reply waits for the words, counted from when the call started. */
const MEMORY_SEARCH_WORDS_WAIT_MS = 2_000;
// Claude Subscription starts the Claude app for every call (about 4-5 s), so the words would never arrive in time:
// skip the call rather than pay for one the reply throws away. Every other provider is a plain HTTP request.
const SLOW_PROVIDER = "claude_subscription";
const SLOW_PROVIDER_PROBLEM =
  "Claude Subscription is too slow for it (it starts the Claude app for each call). Route Memory to a quick API model, such as a small OpenRouter or NanoGPT one.";
// After this many late answers in a row from one connection and model, stop calling it for SKIP_LATE_FOR_MS. After
// that one call is tried again: late again skips again at once, on time starts over.
const LATE_STREAK_TO_SKIP = 3;
const SKIP_LATE_FOR_MS = 30 * 60_000;
// Thinking models (Gemini Flash) spend their first tokens thinking; a small limit cut the list off.
const MAX_OUTPUT_TOKENS = 600;
const MAX_INPUT_CHARS = 1_200;
const MAX_WORDS_CHARS = 240;
const JOB = "memory search";

const INSTRUCTIONS = [
  "You help a chat app search its saved memories of a story.",
  "The user just wrote the message below. List the words a saved memory about what the message refers to would most likely contain: concrete nouns, names, objects, places, body parts, synonyms.",
  "8 to 15 words, comma-separated, no explanation. Do not invent story details.",
].join(" ");

export interface MemorySearchWordsInput {
  storage: StorageGateway;
  llm: LlmGateway;
  chatId: string;
  /** The user's message, as the reply will search with it. */
  text: string;
  /** False skips the call (a chat with nothing saved yet has nothing to search). */
  hasMemories: () => Promise<boolean>;
  /** The turn's signal: stopping the reply stops the helper call too. */
  signal?: AbortSignal;
  now?: () => number;
}

export interface PendingMemorySearchWords {
  startedAt: number;
  /** The connection and model the call went to, once known (lateness is kept per connection). */
  connectionKey: string | null;
  /** Resolves to the words, or null when the helper is unavailable or failed. Never rejects. */
  words: Promise<string | null>;
  /** Stops the helper call (a late answer is not used). */
  cancel(): void;
}

/** Keeps a comma-separated word list from the helper's answer; null when there is none. */
export function parseMemorySearchWords(raw: string): string | null {
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const words = firstLine
    .replace(/^(?:words|keywords|search words)\s*:\s*/i, "")
    .split(",")
    .map((word) => word.replace(/[^\p{L}\p{N}' -]/gu, "").trim())
    .filter((word) => word.length > 0 && word.length <= 40);
  if (words.length < 2) return null;
  let joined = "";
  for (const word of words) {
    const next = joined ? `${joined}, ${word}` : word;
    if (next.length > MAX_WORDS_CHARS) break;
    joined = next;
  }
  return joined || null;
}

/** The text the keyword side of memory search matches against: the message, plus the words on their own line. */
export function memorySearchQuery(text: string, words: string | null | undefined): string {
  const extra = readString(words).trim();
  return extra ? `${text}\n${extra}` : text;
}

/** Late answers in a row, per connection and model, in this runtime. */
const lateness = new Map<string, { streak: number; skipUntil: number }>();

function recordTiming(key: string | null, late: boolean, now: number): void {
  if (!key) return;
  if (!late) {
    lateness.delete(key);
    return;
  }
  const streak = (lateness.get(key)?.streak ?? 0) + 1;
  lateness.set(key, { streak, skipUntil: streak >= LATE_STREAK_TO_SKIP ? now + SKIP_LATE_FOR_MS : 0 });
}

/** Starts the helper call. Failures are logged and resolve to null: the search then uses the message alone. */
export function startMemorySearchWords(input: MemorySearchWordsInput): PendingMemorySearchWords {
  const controller = new AbortController();
  const now = input.now ?? Date.now;
  const startedAt = now();
  const pending: PendingMemorySearchWords = {
    startedAt,
    connectionKey: null,
    words: Promise.resolve(null),
    cancel: () => controller.abort(),
  };
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  pending.words = (async () => {
    if (!(await input.hasMemories())) return null;
    const connection = await resolveHelperRoute(input.storage, "memory", { job: JOB, chatId: input.chatId });
    if (!connection) return null;
    const connectionId = readString(connection.id).trim();
    const model = readString(connection.model).trim();
    const key = `${connectionId}|${model}`;
    const note = (problem?: string) =>
      void noteHelperRun(input.storage, {
        task: "memory",
        rule: "route",
        connectionId,
        connection,
        job: JOB,
        chatId: input.chatId,
        problem,
      });
    if (readString(connection.provider).trim() === SLOW_PROVIDER) {
      note(SLOW_PROVIDER_PROBLEM);
      return null;
    }
    if ((lateness.get(key)?.skipUntil ?? 0) > now()) {
      const name = readString(connection.name).trim() || "This connection";
      note(
        `${name} answered too late for ${LATE_STREAK_TO_SKIP} replies in a row, so it's skipped for ${SKIP_LATE_FOR_MS / 60_000} minutes. Route Memory to a quicker API model.`,
      );
      return null;
    }
    pending.connectionKey = key;
    note();
    const messages: LlmMessage[] = [
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: `Message: ${input.text.trim().slice(0, MAX_INPUT_CHARS)}` },
    ];
    const raw = await input.llm.complete(
      {
        connectionId,
        model: model || null,
        messages,
        parameters: { temperature: 0, maxTokens: MAX_OUTPUT_TOKENS, reasoningEffort: "low" },
      },
      controller.signal,
    );
    return parseMemorySearchWords(raw);
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) {
      console.warn("[memory-search] the search-words helper failed; searching with the message alone", error);
    }
    return null;
  });
  return pending;
}

/**
 * The words if they arrive within {@link MEMORY_SEARCH_WORDS_WAIT_MS} of the start, else null (and the call is
 * cancelled). `late` tells the caller the wait ran out.
 */
export async function memorySearchWordsWithin(
  pending: PendingMemorySearchWords | null,
  options: { waitMs?: number; now?: () => number } = {},
): Promise<{ words: string | null; late: boolean; elapsedMs: number }> {
  if (!pending) return { words: null, late: false, elapsedMs: 0 };
  const now = options.now ?? Date.now;
  const remaining = Math.max(0, pending.startedAt + (options.waitMs ?? MEMORY_SEARCH_WORDS_WAIT_MS) - now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), remaining);
  });
  const result = await Promise.race([pending.words, timeout]);
  clearTimeout(timer);
  const elapsedMs = Math.max(0, now() - pending.startedAt);
  if (result === "late") {
    pending.cancel();
    recordTiming(pending.connectionKey, true, now());
    return { words: null, late: true, elapsedMs };
  }
  // A failed call (null) says nothing about speed.
  if (result !== null) recordTiming(pending.connectionKey, false, now());
  return { words: result, late: false, elapsedMs };
}
