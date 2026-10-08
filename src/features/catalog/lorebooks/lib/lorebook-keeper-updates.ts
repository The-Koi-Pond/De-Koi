import type { QueryClient } from "@tanstack/react-query";
import {
  applyLorebookKeeperUpdate as applyLorebookKeeperUpdateToStorage,
  isLorebookKeeperResult,
  lorebookKeeperProposalEntryId,
  lorebookKeeperRawUpdates,
  lorebookKeeperReviewStatus,
  resolveLorebookKeeperUpdate,
  type LorebookKeeperReviewStatus,
} from "../../../../engine/generation/lorebook-keeper-updates";
import { integrationGateway } from "../../../../shared/api/integration-gateway";
import { lorebookCommandApi } from "../../../../shared/api/lorebook-command-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useAgentStore, type PendingLorebookUpdate } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { lorebookKeys } from "../query-keys";

type JsonRecord = Record<string, unknown>;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function applyLorebookKeeperUpdate(update: PendingLorebookUpdate) {
  const vectorize = integrationGateway.lorebooks?.vectorizeEntries;
  const proposalEntryId =
    update.runId && update.updateIndex !== undefined
      ? lorebookKeeperProposalEntryId(update.runId, update.updateIndex)
      : undefined;
  return applyLorebookKeeperUpdateToStorage(storageApi, update, vectorize, { proposalEntryId });
}

/** `applying` is an approval that never finished (its tab closed); approving it again completes it. */
function awaitingDecision(status: LorebookKeeperReviewStatus | null): boolean {
  return status === "pending" || status === "applying";
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
      lorebookKeeperRawUpdates(run.resultData).some((update) => awaitingDecision(lorebookKeeperReviewStatus(update))),
  );
  if (keeperRuns.length === 0) return [];
  // Read failures reject rather than pass for "nothing to review"; the proposals stay pending and
  // are offered the next time the chat opens.
  const [chat, lorebooks] = await Promise.all([
    storageApi.get<JsonRecord>("chats", chatId),
    storageApi.list<JsonRecord>("lorebooks"),
  ]);
  const pending: PendingLorebookUpdate[] = [];
  for (const run of keeperRuns) {
    const runId = readString(run.id);
    const createdAt = Date.parse(readString(run.createdAt)) || 0;
    lorebookKeeperRawUpdates(run.resultData).forEach((rawUpdate, updateIndex) => {
      if (!awaitingDecision(lorebookKeeperReviewStatus(rawUpdate))) return;
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

export type LorebookKeeperReviewOutcome = "applied" | "rejected" | "already-reviewed";

/** The stored proposal is mid-approval in another tab; it can't be rejected now. */
export class LorebookKeeperReviewBusyError extends Error {
  constructor(entryName: string) {
    super(`"${entryName}" is being applied in another tab.`);
  }
}

function keeperReviewTransition(
  update: PendingLorebookUpdate & { runId: string; updateIndex: number },
  expectedStatuses: Array<"pending" | "applying">,
  status: "pending" | "applying" | "applied" | "rejected",
) {
  return lorebookCommandApi.keeperReviewUpdate({
    runId: update.runId,
    updateIndex: update.updateIndex,
    expectedStatuses,
    status,
  });
}

function storedProposal(
  update: PendingLorebookUpdate,
): (PendingLorebookUpdate & { runId: string; updateIndex: number }) | null {
  return update.runId && update.updateIndex !== undefined
    ? (update as PendingLorebookUpdate & { runId: string; updateIndex: number })
    : null;
}

/**
 * Approve a proposal. A stored one is first claimed (`pending`/`applying` -> `applying`) in one atomic
 * step, so a reject from another tab can't land on top of it, and a proposal another tab already
 * decided is left alone. Applying again from `applying` (a retry, or a tab that died mid-approval) is
 * safe: the write is idempotent. If the write fails the claim is handed back to `pending`.
 */
export async function approveLorebookKeeperProposal(
  update: PendingLorebookUpdate,
): Promise<LorebookKeeperReviewOutcome> {
  const stored = storedProposal(update);
  if (!stored) {
    await applyLorebookKeeperUpdate(update);
    return "applied";
  }
  const claim = await keeperReviewTransition(stored, ["pending", "applying"], "applying");
  if (!claim.updated) return "already-reviewed";
  try {
    await applyLorebookKeeperUpdate(stored);
  } catch (error) {
    await keeperReviewTransition(stored, ["applying"], "pending").catch((releaseError: unknown) => {
      console.warn("[lorebook-keeper] could not hand a failed approval back for review", releaseError);
    });
    throw error;
  }
  const settled = await keeperReviewTransition(stored, ["applying"], "applied");
  return settled.updated || settled.status === "applied" ? "applied" : "already-reviewed";
}

/** Reject a proposal; only one still `pending` can be rejected, so a racing approval always wins cleanly. */
export async function rejectLorebookKeeperProposal(
  update: PendingLorebookUpdate,
): Promise<LorebookKeeperReviewOutcome> {
  const stored = storedProposal(update);
  if (!stored) return "rejected";
  const result = await keeperReviewTransition(stored, ["pending"], "rejected");
  if (result.updated) return "rejected";
  if (result.status === "applying") throw new LorebookKeeperReviewBusyError(update.entryName);
  return "already-reviewed";
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
