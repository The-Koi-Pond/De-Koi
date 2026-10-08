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

import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  loadPendingLorebookKeeperReviews,
  lorebookKeeperReviewStillPending,
  recordLorebookKeeperReview,
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

  it("saves the decision on the proposal's run, leaving its other proposals as they were", async () => {
    storedRuns([keeperRun]);
    const [first] = await loadPendingLorebookKeeperReviews("chat-1");

    await recordLorebookKeeperReview(first!, "rejected");

    expect(storageApi.update).toHaveBeenCalledWith("agent-runs", "run-1", {
      resultData: {
        updates: [
          expect.objectContaining({ entryName: "Archivist koi", reviewStatus: "rejected" }),
          expect.objectContaining({ entryName: "Lantern", reviewStatus: "applied" }),
          expect.objectContaining({ entryName: "Ledger", reviewStatus: "pending" }),
        ],
      },
    });
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

  it("sees a proposal another tab already decided as no longer pending", async () => {
    storedRuns([keeperRun]);
    const [first, second] = await loadPendingLorebookKeeperReviews("chat-1");
    storedRuns([
      {
        ...keeperRun,
        resultData: {
          updates: keeperRun.resultData.updates.map((u, i) => (i === 0 ? { ...u, reviewStatus: "applied" } : u)),
        },
      },
    ]);

    expect(await lorebookKeeperReviewStillPending(first!)).toBe(false);
    expect(await lorebookKeeperReviewStillPending(second!)).toBe(true);
  });
});
