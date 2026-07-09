import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries } from "./auto-summary.service";

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
  promise: Promise<void>;
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

export function cancelConversationSummaryBackfill(storage: StorageGateway, chatId: string): void {
  const normalized = normalizedChatId(chatId);
  if (!normalized) return;
  activeWorkers.get(storage)?.get(normalized)?.controller.abort();
}

export function scheduleConversationSummaryBackfill(
  deps: ConversationSummaryBackgroundDeps,
  input: ScheduleConversationSummaryBackfillInput,
): void {
  const chatId = normalizedChatId(input.chatId);
  if (!chatId) return;

  const workers = workerMap(deps.storage);
  const existingWorker = workers.get(chatId);
  if (existingWorker && !existingWorker.controller.signal.aborted) return;

  const controller = new AbortController();
  const worker = {} as ActiveConversationSummaryWorker;
  worker.controller = controller;
  worker.promise = backfillConversationSummaries(deps, {
    chatId,
    connectionId: input.connectionId,
    timeZone: input.timeZone,
    maxMissingDays: 1,
    signal: controller.signal,
  })
    .then((result) => {
      if (controller.signal.aborted) return;
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
    })
    .catch((error) => {
      if (controller.signal.aborted || abortError(error)) return;
      console.warn("[generation] conversation summary background backfill failed", {
        chatId,
        error: errorMessage(error),
      });
    })
    .finally(() => {
      if (workers.get(chatId) === worker) workers.delete(chatId);
      if (workers.size === 0 && activeWorkers.get(deps.storage) === workers) activeWorkers.delete(deps.storage);
    });
  workers.set(chatId, worker);
}
