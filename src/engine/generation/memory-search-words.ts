import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { backgroundConnectionRule, resolveBackgroundTextConnection } from "./background-llm-connection";
import { noteHelperRun, resolveHelperRoute } from "./helper-runs";
import { readString, type JsonRecord } from "./runtime-records";

/**
 * Memory search words: before a reply, a small helper call lists the words a saved memory about the user's message
 * would likely contain (names, objects, places, synonyms). Memory recall, canonical memories and Story Continuity
 * add them to their keyword match, so "what I lent you back at the lock" can find "Cass gave Odile the oilskin coat".
 * Without an embedding model, recall only matches shared words; in the long-chat lab (#1708) this took questions that
 * share no words with the fact from 15/72 to 36/72 reaching the prompt, with keyword questions also up (61 to 71/72).
 *
 * The call starts as the turn starts and runs alongside saving the message and loading history. Prompt assembly
 * waits for it only until {@link MEMORY_SEARCH_WORDS_WAIT_MS} after the start; a late answer is dropped and the
 * search uses the message alone, as before. It runs on the Helper Models Memory route, else the connection memory
 * capture uses, and is skipped on Claude Subscription (too slow; see SLOW_PROVIDER).
 */

/** Longest the reply waits for the words, counted from when the call started. */
const MEMORY_SEARCH_WORDS_WAIT_MS = 2_000;
// Claude Subscription starts the Claude app for every call (about 4-5 s), so the words would never arrive in time:
// skip the call rather than pay for one the reply throws away. Every other provider is a plain HTTP request.
const SLOW_PROVIDER = "claude_subscription";
const SLOW_PROVIDER_PROBLEM =
  "Claude Subscription is too slow for it (it starts the Claude app for each call). Route Memory to a quick API model, such as a small OpenRouter or NanoGPT one.";
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
  /** The reply's connection: memory capture's fallback when no Memory route is set. */
  replyConnection: () => Promise<JsonRecord | null>;
  /** The turn's signal: stopping the reply stops the helper call too. */
  signal?: AbortSignal;
  now?: () => number;
}

export interface PendingMemorySearchWords {
  startedAt: number;
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

/** Starts the helper call. Failures are logged and resolve to null: the search then uses the message alone. */
export function startMemorySearchWords(input: MemorySearchWordsInput): PendingMemorySearchWords {
  const controller = new AbortController();
  const startedAt = (input.now ?? Date.now)();
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const words = (async () => {
    if (!(await input.hasMemories())) return null;
    const routed = await resolveHelperRoute(input.storage, "memory", { job: JOB, chatId: input.chatId });
    let connection = routed;
    let replyConnectionId: string | null = null;
    if (!connection) {
      const reply = await input.replyConnection();
      replyConnectionId = readString(reply?.id).trim() || null;
      connection = await resolveBackgroundTextConnection(input.storage, replyConnectionId, readString(reply?.model));
    }
    const connectionId = readString(connection.id).trim();
    if (readString(connection.provider).trim() === SLOW_PROVIDER) {
      void noteHelperRun(input.storage, {
        task: "memory",
        rule: routed ? "route" : backgroundConnectionRule(connection, replyConnectionId),
        connectionId,
        connection,
        job: JOB,
        chatId: input.chatId,
        problem: SLOW_PROVIDER_PROBLEM,
      });
      return null;
    }
    void noteHelperRun(input.storage, {
      task: "memory",
      rule: routed ? "route" : backgroundConnectionRule(connection, replyConnectionId),
      connectionId,
      connection,
      job: JOB,
      chatId: input.chatId,
    });
    const messages: LlmMessage[] = [
      { role: "system", content: INSTRUCTIONS },
      { role: "user", content: `Message: ${input.text.trim().slice(0, MAX_INPUT_CHARS)}` },
    ];
    const raw = await input.llm.complete(
      {
        connectionId,
        model: readString(connection.model).trim() || null,
        messages,
        parameters: { temperature: 0, maxTokens: 120, reasoningEffort: "low" },
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
  return { startedAt, words, cancel: () => controller.abort() };
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
    return { words: null, late: true, elapsedMs };
  }
  return { words: result, late: false, elapsedMs };
}
