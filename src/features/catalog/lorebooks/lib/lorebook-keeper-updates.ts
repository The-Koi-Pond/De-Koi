import type { QueryClient } from "@tanstack/react-query";
import {
  applyLorebookKeeperUpdate as applyLorebookKeeperUpdateToStorage,
  isLorebookKeeperResult,
  lorebookKeeperRawUpdates,
  lorebookKeeperReviewStatus,
  resolveLorebookKeeperUpdate,
  type LorebookKeeperReviewStatus,
} from "../../../../engine/generation/lorebook-keeper-updates";
import { integrationGateway } from "../../../../shared/api/integration-gateway";
import { storageApi } from "../../../../shared/api/storage-api";
import { useAgentStore, type PendingLorebookUpdate } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { lorebookKeys } from "../query-keys";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value === "string" && value.trim()) {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function applyLorebookKeeperUpdate(update: PendingLorebookUpdate) {
  const vectorize = integrationGateway.lorebooks?.vectorizeEntries;
  return applyLorebookKeeperUpdateToStorage(storageApi, update, vectorize);
}

/**
 * The Keeper proposals still waiting for a decision in this chat. They are read from the stored
 * Keeper runs, so a proposal made while no tab was open (or in another tab) still shows up here.
 */
export async function loadPendingLorebookKeeperReviews(chatId: string): Promise<PendingLorebookUpdate[]> {
  const runs = await storageApi.list<JsonRecord>("agent-runs", { filters: { chatId } });
  const keeperRuns = runs.filter(
    (run) =>
      run.success !== false &&
      isLorebookKeeperResult({ agentType: readString(run.agentType), type: readString(run.resultType) }) &&
      lorebookKeeperRawUpdates(run.resultData).some((update) => lorebookKeeperReviewStatus(update) === "pending"),
  );
  if (keeperRuns.length === 0) return [];
  const [chat, lorebooks] = await Promise.all([
    storageApi.get<JsonRecord>("chats", chatId).catch(() => null),
    storageApi.list<JsonRecord>("lorebooks").catch(() => []),
  ]);
  const pending: PendingLorebookUpdate[] = [];
  for (const run of keeperRuns) {
    const runId = readString(run.id);
    const createdAt = Date.parse(readString(run.createdAt)) || 0;
    lorebookKeeperRawUpdates(run.resultData).forEach((rawUpdate, updateIndex) => {
      if (lorebookKeeperReviewStatus(rawUpdate) !== "pending") return;
      const update = resolveLorebookKeeperUpdate(rawUpdate, { chat, lorebooks });
      if (!update) return;
      pending.push({
        ...update,
        id: `${runId}:${updateIndex}`,
        chatId,
        runId,
        updateIndex,
        agentName: readString(run.agentName) || "Lorebook Keeper",
        timestamp: createdAt + updateIndex,
      });
    });
  }
  return pending.sort((left, right) => left.timestamp - right.timestamp);
}

/**
 * Whether the proposal still waits for a decision on its stored run. Another tab may have decided it
 * since this one queued it; approving it again would write the entry twice.
 */
export async function lorebookKeeperReviewStillPending(update: PendingLorebookUpdate): Promise<boolean> {
  if (!update.runId || update.updateIndex === undefined) return true;
  const run = await storageApi.get<JsonRecord>("agent-runs", update.runId);
  const stored = run ? lorebookKeeperRawUpdates(run.resultData)[update.updateIndex] : undefined;
  return !!stored && lorebookKeeperReviewStatus(stored) === "pending";
}

/** Store the decision on the proposal's Keeper run, so it is not offered again. */
export async function recordLorebookKeeperReview(
  update: PendingLorebookUpdate,
  status: Extract<LorebookKeeperReviewStatus, "applied" | "rejected">,
): Promise<void> {
  if (!update.runId || update.updateIndex === undefined) return;
  const run = await storageApi.get<JsonRecord>("agent-runs", update.runId);
  if (!run) return;
  const resultData = asRecord(run.resultData);
  const updates = lorebookKeeperRawUpdates(resultData);
  if (!updates[update.updateIndex]) return;
  updates[update.updateIndex] = { ...updates[update.updateIndex], reviewStatus: status };
  await storageApi.update("agent-runs", update.runId, { resultData: { ...resultData, updates } });
}

/** Queue this chat's undecided proposals in the review dialog and open it when any are new. */
export async function showPendingLorebookKeeperReviews(chatId: string): Promise<void> {
  const pending = await loadPendingLorebookKeeperReviews(chatId);
  const agentStore = useAgentStore.getState();
  const queued = new Set(agentStore.pendingLorebookUpdates.map((entry) => entry.id));
  const fresh = pending.filter((entry) => !queued.has(entry.id));
  for (const entry of fresh) agentStore.enqueuePendingLorebookUpdate(entry);
  // Never cover another dialog; the queued proposals wait for the next time this chat opens.
  if (fresh.length > 0 && !useUIStore.getState().modal) useUIStore.getState().openModal("lorebook-keeper-review");
}

/** Refresh the lorebook views a Keeper run just wrote to. */
export async function invalidateLorebookKeeperWrites(queryClient: QueryClient, lorebookIds: string[]): Promise<void> {
  await Promise.all([
    ...lorebookIds.map((lorebookId) => queryClient.invalidateQueries({ queryKey: lorebookKeys.entries(lorebookId) })),
    queryClient.invalidateQueries({ queryKey: lorebookKeys.active() }),
  ]);
}
