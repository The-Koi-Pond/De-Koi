import { beforeEach, describe, expect, it, vi } from "vitest";

const storageApi = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({ storageApi }));
vi.mock("../../../../shared/api/integration-gateway", () => ({ integrationGateway: {} }));

const keeperReviewUpdate = vi.hoisted(() => vi.fn());
vi.mock("../../../../shared/api/lorebook-command-api", () => ({ lorebookCommandApi: { keeperReviewUpdate } }));

import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  applyLorebookKeeperUpdate,
  loadPendingLorebookKeeperReviews,
  approveLorebookKeeperProposal,
  LorebookKeeperReviewBusyError,
  rejectLorebookKeeperProposal,
  showPendingLorebookKeeperReviews,
} from "./lorebook-keeper-updates";

const keeperRun = {
  id: "run-1",
  chatId: "chat-1",
  agentType: "lorebook-keeper",
  agentName: "Lorebook Keeper",
  resultType: "lorebook_update",
  success: true,
  createdAt: "2026-10-08T12:00:00.000Z",
  resultData: {
    updates: [
      { action: "create", entryName: "Archivist koi", content: "Two hundred years old.", reviewStatus: "pending" },
      { action: "create", entryName: "Lantern", reviewStatus: "applied" },
      { action: "create", entryName: "Ledger", reviewStatus: "pending" },
    ],
  },
};

function storedRuns(runs: unknown[]) {
  storageApi.list.mockImplementation(async (entity: string) => {
    if (entity === "agent-runs") return runs;
    if (entity === "lorebooks") return [{ id: "book-1", name: "Pond lore", enabled: true }];
    return [];
  });
  storageApi.get.mockImplementation(async (entity: string, id: string) => {
    if (entity === "chats") return { id, characterIds: [], metadata: { lorebookKeeperTargetLorebookId: "book-1" } };
    if (entity === "agent-runs") return (runs as Array<{ id: string }>).find((run) => run.id === id) ?? null;
    return null;
  });
}

describe("stored Lorebook Keeper reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.getState().clearPendingLorebookUpdates();
    useUIStore.getState().closeModal();
  });

  it("offers only the proposals still pending on stored Keeper runs, tied to their run", async () => {
    storedRuns([keeperRun, { ...keeperRun, id: "run-2", agentType: "world-state", resultType: "game_state_update" }]);

    const pending = await loadPendingLorebookKeeperReviews("chat-1");

    expect(storageApi.list).toHaveBeenCalledWith("agent-runs", { filters: { chatId: "chat-1" } });
    expect(pending).toEqual([
      expect.objectContaining({
        id: "run-1:0",
        runId: "run-1",
        updateIndex: 0,
        entryName: "Archivist koi",
        lorebookId: "book-1",
      }),
      expect.objectContaining({ id: "run-1:2", runId: "run-1", updateIndex: 2, entryName: "Ledger" }),
    ]);
  });

  it("queues each pending proposal once and opens the review dialog only when something is new", async () => {
    storedRuns([keeperRun]);

    await showPendingLorebookKeeperReviews("chat-1");
    expect(useAgentStore.getState().pendingLorebookUpdates.map((entry) => entry.id)).toEqual(["run-1:0", "run-1:2"]);
    expect(useUIStore.getState().modal?.type).toBe("lorebook-keeper-review");

    useUIStore.getState().closeModal();
    await showPendingLorebookKeeperReviews("chat-1");
    expect(useAgentStore.getState().pendingLorebookUpdates).toHaveLength(2);
    expect(useUIStore.getState().modal).toBeNull();
  });

  it("does not cover a dialog that is already open", async () => {
    storedRuns([keeperRun]);
    useUIStore.getState().openModal("create-lorebook" as never);

    await showPendingLorebookKeeperReviews("chat-1");

    expect(useAgentStore.getState().pendingLorebookUpdates).toHaveLength(2);
    expect(useUIStore.getState().modal?.type).toBe("create-lorebook");
  });

  it("rejects when the lorebooks can't be read, so stored proposals aren't mistaken for none", async () => {
    storedRuns([keeperRun]);
    storageApi.list.mockImplementation(async (entity: string) => {
      if (entity === "agent-runs") return [keeperRun];
      throw new Error("runtime unreachable");
    });

    await expect(loadPendingLorebookKeeperReviews("chat-1")).rejects.toThrow("runtime unreachable");
    await expect(showPendingLorebookKeeperReviews("chat-1")).rejects.toThrow("runtime unreachable");
    expect(useAgentStore.getState().pendingLorebookUpdates).toEqual([]);
  });

  it("creates an approved proposal under an id tied to its run, so a repeat can't duplicate it", async () => {
    storedRuns([keeperRun]);
    const [first] = await loadPendingLorebookKeeperReviews("chat-1");
    storageApi.get.mockResolvedValue(null);
    storageApi.create.mockImplementation(async (_entity: string, value: Record<string, unknown>) => value);

    await applyLorebookKeeperUpdate(first!);

    expect(storageApi.create).toHaveBeenCalledWith(
      "lorebook-entries",
      expect.objectContaining({ id: "keeper-run-1-0", name: "Archivist koi" }),
    );
  });

  describe("deciding a stored proposal", () => {
    /** The runtime's rule: move the status only from one it still has. */
    function storedStatus(initial: string) {
      let status = initial;
      keeperReviewUpdate.mockImplementation(async (input: { expectedStatuses: string[]; status: string }) => {
        if (!input.expectedStatuses.includes(status)) return { updated: false, status };
        status = input.status;
        return { updated: true, status };
      });
      return () => status;
    }

    async function storedProposal() {
      storedRuns([keeperRun]);
      const [first] = await loadPendingLorebookKeeperReviews("chat-1");
      storageApi.get.mockResolvedValue(null);
      storageApi.create.mockImplementation(async (_entity: string, value: Record<string, unknown>) => value);
      return first!;
    }

    it("claims the proposal before writing it, then marks it applied", async () => {
      const proposal = await storedProposal();
      const status = storedStatus("pending");

      await expect(approveLorebookKeeperProposal(proposal)).resolves.toBe("applied");

      expect(keeperReviewUpdate.mock.calls.map(([call]) => [call.expectedStatuses, call.status])).toEqual([
        [["pending", "applying"], "applying"],
        [["applying"], "applied"],
      ]);
      expect(keeperReviewUpdate).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", updateIndex: 0 }));
      expect(storageApi.create).toHaveBeenCalledTimes(1);
      expect(status()).toBe("applied");
    });

    it("writes nothing when another tab already rejected it", async () => {
      const proposal = await storedProposal();
      storedStatus("rejected");

      await expect(approveLorebookKeeperProposal(proposal)).resolves.toBe("already-reviewed");
      expect(storageApi.create).not.toHaveBeenCalled();
    });

    it("hands a failed write back for review", async () => {
      const proposal = await storedProposal();
      const status = storedStatus("pending");
      storageApi.create.mockRejectedValueOnce(new Error("disk full"));

      await expect(approveLorebookKeeperProposal(proposal)).rejects.toThrow("disk full");
      expect(status()).toBe("pending");
    });

    it("finishes an approval a closed tab left mid-way", async () => {
      const proposal = await storedProposal();
      const status = storedStatus("applying");

      await expect(approveLorebookKeeperProposal(proposal)).resolves.toBe("applied");
      expect(status()).toBe("applied");
    });

    it("rejects only a pending proposal, and never one another tab is applying", async () => {
      const proposal = await storedProposal();

      let status = storedStatus("pending");
      await expect(rejectLorebookKeeperProposal(proposal)).resolves.toBe("rejected");
      expect(status()).toBe("rejected");

      status = storedStatus("applying");
      await expect(rejectLorebookKeeperProposal(proposal)).rejects.toBeInstanceOf(LorebookKeeperReviewBusyError);
      expect(status()).toBe("applying");

      status = storedStatus("applied");
      await expect(rejectLorebookKeeperProposal(proposal)).resolves.toBe("already-reviewed");
      expect(status()).toBe("applied");
    });
  });

  it("offers an approval a closed tab left mid-way again", async () => {
    storedRuns([
      { ...keeperRun, resultData: { updates: [{ ...keeperRun.resultData.updates[0], reviewStatus: "applying" }] } },
    ]);

    expect((await loadPendingLorebookKeeperReviews("chat-1")).map((entry) => entry.id)).toEqual(["run-1:0"]);
  });
});
