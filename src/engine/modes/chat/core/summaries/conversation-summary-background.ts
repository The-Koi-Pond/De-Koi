import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { createBackgroundJobQueue } from "../../../../generation/background-job-queue";
import { parseRecord, readString, type JsonRecord } from "../../../../generation/runtime-records";
import { backfillConversationSummaries, type ConversationSummaryBackfillResult } from "./auto-summary.service";

export interface ConversationSummaryBackgroundDeps {
  storage: StorageGateway;
  llm: LlmGateway;
}

export interface ScheduleConversationSummaryBackfillInput {
  chatId: string;
  connectionId?: string | null;
  timeZone?: string | null;
}

interface ActiveConversationSummaryWorker {
  controller: AbortController;
}

const activeWorkers = new WeakMap<StorageGateway, Map<string, ActiveConversationSummaryWorker>>();

function normalizedChatId(chatId: string): string {
  return chatId.trim();
}

function workerMap(storage: StorageGateway): Map<string, ActiveConversationSummaryWorker> {
  let workers = activeWorkers.get(storage);
  if (!workers) {
    workers = new Map();
    activeWorkers.set(storage, workers);
  }
  return workers;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown summary backfill error");
}

function abortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

function reportItemFailures(chatId: string, result: ConversationSummaryBackfillResult): void {
  for (const failure of result.failedDays) {
    console.warn("[generation] conversation summary background item failed", {
      chatId,
      stage: "day",
      identifier: failure.date,
      error: failure.error,
    });
  }
  for (const failure of result.failedWeeks) {
    console.warn("[generation] conversation summary background item failed", {
      chatId,
      stage: "week",
      identifier: failure.weekKey,
      error: failure.error,
    });
  }
}

/**
 * Backfill up to one missing day for `chatId`, registered so a reply starting in this chat
 * (`cancelConversationSummaryBackfill`) aborts it. Resolves "aborted" when that happened; other
 * failures reject.
 */
async function runConversationSummaryBackfill(
  deps: ConversationSummaryBackgroundDeps,
  chatId: string,
  input: ScheduleConversationSummaryBackfillInput,
): Promise<"finished" | "aborted"> {
  const workers = workerMap(deps.storage);
  const worker: ActiveConversationSummaryWorker = { controller: new AbortController() };
  const { signal } = worker.controller;
  workers.set(chatId, worker);
  try {
    const result = await backfillConversationSummaries(deps, {
      chatId,
      connectionId: input.connectionId,
      timeZone: input.timeZone,
      maxMissingDays: 1,
      signal,
    });
    if (signal.aborted) return "aborted";
    reportItemFailures(chatId, result);
    return "finished";
  } catch (error) {
    if (signal.aborted || abortError(error)) return "aborted";
    throw error;
  } finally {
    if (workers.get(chatId) === worker) workers.delete(chatId);
    if (workers.size === 0 && activeWorkers.get(deps.storage) === workers) activeWorkers.delete(deps.storage);
  }
}

export function cancelConversationSummaryBackfill(storage: StorageGateway, chatId: string): void {
  const normalized = normalizedChatId(chatId);
  if (!normalized) return;
  activeWorkers.get(storage)?.get(normalized)?.controller.abort();
}

/** Run the backfill in this tab now (for runtimes that cannot store background jobs). */
export function scheduleConversationSummaryBackfill(
  deps: ConversationSummaryBackgroundDeps,
  input: ScheduleConversationSummaryBackfillInput,
): void {
  const chatId = normalizedChatId(input.chatId);
  if (!chatId) return;

  const existingWorker = activeWorkers.get(deps.storage)?.get(chatId);
  if (existingWorker && !existingWorker.controller.signal.aborted) return;

  void runConversationSummaryBackfill(deps, chatId, input).catch((error: unknown) => {
    console.warn("[generation] conversation summary background backfill failed", {
      chatId,
      error: errorMessage(error),
    });
  });
}

function summaryJobPayload(input: ScheduleConversationSummaryBackfillInput) {
  return { connectionId: input.connectionId ?? null, timeZone: input.timeZone ?? null };
}

// Stored on the runtime, so closing the tab after a reply no longer drops the summary pass. Only
// past days are summarized (never today), so a reply still being written can't change what it reads.
const conversationSummaryQueue = createBackgroundJobQueue<ConversationSummaryBackgroundDeps>({
  queue: "conversation-summary",
  async run(job, deps) {
    const chatId = normalizedChatId(job.chatId ?? job.key);
    const chat = await deps.storage.get<JsonRecord>("chats", chatId);
    if (!chat || chat.mode !== "conversation") return "done";
    const payload = parseRecord(job.payload);
    const input = {
      chatId,
      connectionId: readString(payload.connectionId).trim() || null,
      timeZone: readString(payload.timeZone).trim() || null,
    };
    if ((await runConversationSummaryBackfill(deps, chatId, input)) === "aborted") {
      // A reply started in this chat. Queue it again: it runs once that reply is done.
      await conversationSummaryQueue.enqueue(deps, { key: chatId, chatId, payload: summaryJobPayload(input) });
    }
    return "done";
  },
});

/**
 * Store the summary pass for `chatId` on the runtime. Resolves false when the runtime cannot store
 * it, so the caller runs it in this tab instead (`scheduleConversationSummaryBackfill`).
 */
export async function queueConversationSummaryBackfill(
  deps: ConversationSummaryBackgroundDeps,
  input: ScheduleConversationSummaryBackfillInput,
): Promise<boolean> {
  const chatId = normalizedChatId(input.chatId);
  if (!chatId || !deps.storage.backgroundJobs) return false;
  try {
    await conversationSummaryQueue.enqueue(deps, { key: chatId, chatId, payload: summaryJobPayload(input) });
    return true;
  } catch (error) {
    console.warn("[generation] could not queue the conversation summary; running it in this tab", {
      chatId,
      error: errorMessage(error),
    });
    return false;
  }
}

/** Run summary passes a closed or reloaded tab left queued; call once a client starts. */
export function resumeQueuedConversationSummaries(deps: ConversationSummaryBackgroundDeps): void {
  conversationSummaryQueue.schedule(deps);
}
