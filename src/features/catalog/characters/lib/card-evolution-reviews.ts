import {
  cardEvolutionRawUpdates,
  cardEvolutionReviewStatus,
  isCardEvolutionResult,
  parseCharacterCardFieldUpdate,
  type CardEvolutionReviewStatus,
} from "../../../../engine/generation/card-evolution-reviews";
import type { CharacterCardFieldUpdate } from "../../../../engine/contracts/types/agent";
import { lorebookCommandApi } from "../../../../shared/api/lorebook-command-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useAgentStore, type PendingCardUpdate } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";

type JsonRecord = Record<string, unknown>;

/** A review entry read from a stored run: one character's proposals, at these indexes of the run's updates. */
type StoredCardUpdate = PendingCardUpdate & { runId: string; updateIndexes: number[] };

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

function idList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string") return [];
  try {
    return idList(JSON.parse(value));
  } catch {
    return [];
  }
}

/** `applying` is an approval that never finished (its tab closed); approving it again completes it. */
function awaitingDecision(status: CardEvolutionReviewStatus | null): boolean {
  return status === "pending" || status === "applying";
}

async function characterName(characterId: string): Promise<string> {
  const row = await storageApi.get<JsonRecord>("characters", characterId, {
    fields: ["id", "data"],
    fieldSelections: { data: ["name"] },
  });
  return readString(parseRecord(row?.data).name) || readString(row?.name) || "Character";
}

/**
 * The Card Evolution proposals still waiting for a decision in this chat, one entry per run and
 * character. Only runs recovered after their tab closed store proposals for review, so these are the
 * ones no tab ever showed.
 */
export async function loadPendingCardEvolutionReviews(chatId: string): Promise<PendingCardUpdate[]> {
  const runs = await storageApi.list<JsonRecord>("agent-runs", { filters: { chatId } });
  const cardRuns = runs.filter(
    (run) =>
      run.success !== false &&
      isCardEvolutionResult({ agentType: readString(run.agentType), type: readString(run.resultType) }) &&
      cardEvolutionRawUpdates(run.resultData).some((update) => awaitingDecision(cardEvolutionReviewStatus(update))),
  );
  if (cardRuns.length === 0) return [];
  // A failed read rejects rather than passing for "nothing to review"; the proposals stay pending and
  // are offered the next time the chat opens.
  const chat = await storageApi.get<JsonRecord>("chats", chatId);
  const chatCharacterIds = idList(chat?.characterIds);
  const names = new Map<string, Promise<string>>();
  const pending: StoredCardUpdate[] = [];
  for (const run of cardRuns) {
    const runId = readString(run.id);
    const createdAt = Date.parse(readString(run.createdAt)) || 0;
    const byCharacter = new Map<string, { updates: CharacterCardFieldUpdate[]; indexes: number[] }>();
    cardEvolutionRawUpdates(run.resultData).forEach((raw, index) => {
      if (!awaitingDecision(cardEvolutionReviewStatus(raw))) return;
      const update = parseCharacterCardFieldUpdate(raw);
      if (!update || !chatCharacterIds.includes(update.characterId)) return;
      const group = byCharacter.get(update.characterId) ?? { updates: [], indexes: [] };
      group.updates.push(update);
      group.indexes.push(index);
      byCharacter.set(update.characterId, group);
    });
    for (const [characterId, group] of byCharacter) {
      if (!names.has(characterId)) names.set(characterId, characterName(characterId));
      pending.push({
        id: `${runId}:${characterId}`,
        characterId,
        characterName: await names.get(characterId)!,
        updates: group.updates,
        agentName: readString(run.agentName) || "Card Evolution Auditor",
        timestamp: createdAt + chatCharacterIds.indexOf(characterId),
        runId,
        updateIndexes: group.indexes,
      });
    }
  }
  return pending.sort((left, right) => left.timestamp - right.timestamp);
}

export type CardEvolutionReviewOutcome = "applied" | "rejected" | "already-reviewed";

/** The stored proposals are mid-approval in another tab; they can't be decided here now. */
export class CardEvolutionReviewBusyError extends Error {
  constructor(characterName: string) {
    super(`${characterName}'s card update is being applied in another tab.`);
  }
}

/**
 * An approval that never finished (its tab closed mid-write) can be taken over after this long. A live
 * approval is one character save, far shorter.
 */
const ABANDONED_CARD_CLAIM_MS = 5 * 60_000;

function storedEntry(entry: PendingCardUpdate): StoredCardUpdate | null {
  return entry.runId && entry.updateIndexes?.length ? (entry as StoredCardUpdate) : null;
}

// The runtime's proposal review command moves one stored proposal (`resultData.updates[i]`) of any
// agent run atomically; Card Evolution runs store theirs in the same shape as the Lorebook Keeper.
function transition(
  entry: StoredCardUpdate,
  updateIndex: number,
  expectedStatuses: Array<"pending" | "applying">,
  status: CardEvolutionReviewStatus,
  claim: { claimId?: string; staleAfterMs?: number } = {},
) {
  return lorebookCommandApi.keeperReviewUpdate({
    runId: entry.runId,
    updateIndex,
    expectedStatuses,
    status,
    ...claim,
  });
}

/**
 * Approve one character's stored proposals: claim each for this approval alone (`pending` -> `applying`,
 * atomically, lowest index first, as rejections go too, so the first proposal decides which tab wins),
 * write the card with `apply`, then settle them. `apply` resolves with the positions (in `entry.updates`)
 * of the edits it wrote: those settle `applied`, the rest (stale edits it left out) `rejected`, so a
 * proposal is only ever recorded as applied when it reached the card. If the write fails, the claims
 * are handed back to `pending` and the error surfaces. A live (unstored) entry is just applied.
 */
export async function approveCardEvolutionReview(
  entry: PendingCardUpdate,
  apply: () => Promise<number[]>,
): Promise<CardEvolutionReviewOutcome> {
  const stored = storedEntry(entry);
  if (!stored) {
    await apply();
    return "applied";
  }
  const claimId = `approve-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const claimed: number[] = [];
  const releaseClaims = async () => {
    for (const index of claimed) {
      await transition(stored, index, ["applying"], "pending", { claimId }).catch((error: unknown) => {
        console.warn("[card-evolution] could not hand a failed approval back for review", error);
      });
    }
  };
  for (const index of stored.updateIndexes) {
    const claim = await transition(stored, index, ["pending", "applying"], "applying", {
      claimId,
      staleAfterMs: ABANDONED_CARD_CLAIM_MS,
    });
    if (!claim.updated) {
      await releaseClaims();
      if (claim.status === "applying") throw new CardEvolutionReviewBusyError(entry.characterName);
      return "already-reviewed";
    }
    claimed.push(index);
  }
  let written: Set<number>;
  try {
    written = new Set(await apply());
  } catch (error) {
    await releaseClaims();
    throw error;
  }
  for (const [position, index] of stored.updateIndexes.entries()) {
    const status = written.has(position) ? "applied" : "rejected";
    const settled = await transition(stored, index, ["applying"], status, { claimId });
    if (!settled.updated && settled.status !== status) {
      // The card was written but this claim no longer owns the proposal; say so rather than report a decision.
      throw new Error(`${entry.characterName}'s card update was taken over by another tab while it was being applied.`);
    }
  }
  return "applied";
}

/** Reject one character's stored proposals; only `pending` ones can be, so a racing approval wins cleanly. */
export async function rejectCardEvolutionReview(entry: PendingCardUpdate): Promise<CardEvolutionReviewOutcome> {
  const stored = storedEntry(entry);
  if (!stored) return "rejected";
  let rejected = false;
  for (const index of stored.updateIndexes) {
    const result = await transition(stored, index, ["pending"], "rejected");
    if (result.updated) {
      rejected = true;
      continue;
    }
    if (result.status === "applying") throw new CardEvolutionReviewBusyError(entry.characterName);
  }
  return rejected ? "rejected" : "already-reviewed";
}

/**
 * Queue this chat's undecided stored proposals in the review dialog and open it when any are new.
 * `stillWanted` is checked once they are loaded, so a chat the user left meanwhile queues nothing.
 */
export async function showPendingCardEvolutionReviews(
  chatId: string,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  const pending = await loadPendingCardEvolutionReviews(chatId);
  if (!stillWanted()) return;
  const agentStore = useAgentStore.getState();
  const queued = new Set(agentStore.pendingCardUpdates.map((entry) => entry.id));
  const fresh = pending.filter((entry) => !queued.has(entry.id));
  for (const entry of fresh) agentStore.enqueuePendingCardUpdate(entry);
  // Never cover another dialog; the queued proposals wait for the next time this chat opens.
  if (fresh.length > 0 && !useUIStore.getState().modal) useUIStore.getState().openModal("character-card-update");
}
