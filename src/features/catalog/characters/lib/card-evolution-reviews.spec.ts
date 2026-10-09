import { beforeEach, describe, expect, it, vi } from "vitest";

const storageApi = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi }));

const keeperReviewUpdate = vi.hoisted(() => vi.fn());
vi.mock("../../../../shared/api/lorebook-command-api", () => ({ lorebookCommandApi: { keeperReviewUpdate } }));

import { useAgentStore, type PendingCardUpdate } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  approveCardEvolutionReview,
  CardEvolutionReviewBusyError,
  loadPendingCardEvolutionReviews,
  rejectCardEvolutionReview,
  showPendingCardEvolutionReviews,
} from "./card-evolution-reviews";

type Row = Record<string, unknown>;

function update(characterId: string, field: string, reviewStatus?: string): Row {
  return {
    characterId,
    action: "update",
    field,
    oldText: `old ${field}`,
    newText: `new ${field}`,
    reason: "Shown in the reply.",
    ...(reviewStatus ? { reviewStatus } : {}),
  };
}

const auditorRun = {
  id: "run-1",
  chatId: "chat-1",
  agentType: "card-evolution-auditor",
  agentName: "Card Evolution Auditor",
  resultType: "character_card_update",
  success: true,
  createdAt: "2026-10-08T12:00:00.000Z",
  resultData: {
    updates: [
      update("mira", "description", "pending"),
      update("pip", "personality", "pending"),
      update("mira", "personality", "applied"),
      update("mira", "scenario", "applying"),
      update("stranger", "description", "pending"),
      update("mira", "backstory"),
    ],
  },
};

function storedRuns(runs: unknown[]) {
  storageApi.list.mockImplementation(async (entity: string) => (entity === "agent-runs" ? runs : []));
  storageApi.get.mockImplementation(async (entity: string, id: string) => {
    if (entity === "chats") return { id, characterIds: ["mira", "pip"] };
    if (entity === "characters") return { id, data: { name: id === "mira" ? "Mira" : "Pip" } };
    return null;
  });
}

/** The runtime's atomic review command over one run's proposals: moves a status only from an expected one. */
function reviewCommand(statuses: string[]) {
  const claims = new Map<number, string>();
  keeperReviewUpdate.mockImplementation(
    async (input: { updateIndex: number; expectedStatuses: string[]; status: string; claimId?: string }) => {
      const current = statuses[input.updateIndex]!;
      const ownsClaim = current !== "applying" || claims.get(input.updateIndex) === input.claimId;
      if (!input.expectedStatuses.includes(current) || !ownsClaim) return { updated: false, status: current };
      statuses[input.updateIndex] = input.status;
      if (input.status === "applying") claims.set(input.updateIndex, input.claimId!);
      return { updated: true, status: input.status };
    },
  );
  return statuses;
}

function storedEntry(updateIndexes = [0, 1]): PendingCardUpdate {
  return {
    id: "run-1:mira",
    characterId: "mira",
    characterName: "Mira",
    updates: [],
    agentName: "Card Evolution Auditor",
    timestamp: 0,
    runId: "run-1",
    updateIndexes,
  };
}

describe("stored Card Evolution reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.getState().clearPendingCardUpdates();
    useUIStore.getState().closeModal();
  });

  it("offers each character's undecided proposals from stored runs, for characters still in the chat", async () => {
    storedRuns([auditorRun, { ...auditorRun, id: "run-2", agentType: "world-state", resultType: "game_state_update" }]);

    const pending = await loadPendingCardEvolutionReviews("chat-1");

    expect(storageApi.list).toHaveBeenCalledWith("agent-runs", { filters: { chatId: "chat-1" } });
    expect(pending).toEqual([
      expect.objectContaining({
        id: "run-1:mira",
        characterName: "Mira",
        runId: "run-1",
        // `applying` is an approval a closed tab never finished; decided and unstored ones are not offered.
        updateIndexes: [0, 3],
        updates: [expect.objectContaining({ field: "description" }), expect.objectContaining({ field: "scenario" })],
      }),
      expect.objectContaining({ id: "run-1:pip", characterName: "Pip", runId: "run-1", updateIndexes: [1] }),
    ]);
  });

  it("rejects a failed read instead of reporting nothing to review", async () => {
    storageApi.list.mockResolvedValue([auditorRun]);
    storageApi.get.mockRejectedValue(new Error("offline"));

    await expect(loadPendingCardEvolutionReviews("chat-1")).rejects.toThrow("offline");
  });

  it("queues each stored entry once and opens the dialog only when nothing else is open", async () => {
    storedRuns([auditorRun]);

    await showPendingCardEvolutionReviews("chat-1");
    await showPendingCardEvolutionReviews("chat-1");

    expect(useAgentStore.getState().pendingCardUpdates.map((entry) => entry.id)).toEqual(["run-1:mira", "run-1:pip"]);
    expect(useUIStore.getState().modal).toEqual(expect.objectContaining({ type: "character-card-update" }));
  });

  it("queues nothing when the chat is no longer wanted once its proposals load", async () => {
    storedRuns([auditorRun]);

    await showPendingCardEvolutionReviews("chat-1", () => false);

    expect(useAgentStore.getState().pendingCardUpdates).toEqual([]);
    expect(useUIStore.getState().modal).toBeNull();
  });

  it("approves by claiming every proposal, writing the card, then settling them applied", async () => {
    const statuses = reviewCommand(["pending", "pending"]);
    const apply = vi.fn(async () => {
      expect(statuses).toEqual(["applying", "applying"]);
      return [0, 1];
    });

    await expect(approveCardEvolutionReview(storedEntry(), apply)).resolves.toBe("applied");

    expect(apply).toHaveBeenCalledOnce();
    expect(statuses).toEqual(["applied", "applied"]);
  });

  it("records a stale edit the card write left out as rejected, never applied", async () => {
    const statuses = reviewCommand(["pending", "pending"]);

    await expect(approveCardEvolutionReview(storedEntry(), async () => [1])).resolves.toBe("applied");

    expect(statuses).toEqual(["rejected", "applied"]);
  });

  it("writes nothing when another tab already rejected them", async () => {
    reviewCommand(["rejected", "rejected"]);
    const apply = vi.fn();

    await expect(approveCardEvolutionReview(storedEntry(), apply)).resolves.toBe("already-reviewed");
    expect(apply).not.toHaveBeenCalled();
  });

  it("writes nothing while another tab is applying them", async () => {
    const statuses = reviewCommand(["pending", "pending"]);
    await approveCardEvolutionReview(storedEntry(), async () => {
      // A second tab approves while this one is writing the card.
      await expect(approveCardEvolutionReview(storedEntry(), vi.fn())).rejects.toBeInstanceOf(
        CardEvolutionReviewBusyError,
      );
      await expect(rejectCardEvolutionReview(storedEntry())).rejects.toBeInstanceOf(CardEvolutionReviewBusyError);
      return [0, 1];
    });
    expect(statuses).toEqual(["applied", "applied"]);
  });

  it("hands the proposals back for review when the card write fails", async () => {
    const statuses = reviewCommand(["pending", "pending"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      approveCardEvolutionReview(storedEntry(), async () => {
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    expect(statuses).toEqual(["pending", "pending"]);
  });

  it("rejects only pending proposals and reports ones decided elsewhere", async () => {
    const statuses = reviewCommand(["pending", "pending"]);
    await expect(rejectCardEvolutionReview(storedEntry())).resolves.toBe("rejected");
    expect(statuses).toEqual(["rejected", "rejected"]);

    reviewCommand(["applied", "applied"]);
    await expect(rejectCardEvolutionReview(storedEntry())).resolves.toBe("already-reviewed");
  });

  it("leaves a live (unstored) entry to the dialog: approve just writes, reject saves nothing", async () => {
    const live = { ...storedEntry(), runId: undefined, updateIndexes: undefined };
    const apply = vi.fn(async () => [0]);

    await expect(approveCardEvolutionReview(live, apply)).resolves.toBe("applied");
    await expect(rejectCardEvolutionReview(live)).resolves.toBe("rejected");
    expect(apply).toHaveBeenCalledOnce();
    expect(keeperReviewUpdate).not.toHaveBeenCalled();
  });
});
