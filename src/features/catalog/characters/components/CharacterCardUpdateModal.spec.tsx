import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cardReviews = vi.hoisted(() => ({
  approveCardEvolutionReview: vi.fn(),
  rejectCardEvolutionReview: vi.fn(),
}));
vi.mock("../lib/card-evolution-reviews", () => cardReviews);

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock("../hooks/use-characters", () => ({
  useCharacter: () => ({ data: { id: "mira", data: { name: "Mira", description: "Mira keeps the lantern." } } }),
  useUpdateCharacter: () => ({ mutateAsync, isPending: false }),
}));

import { useAgentStore, type PendingCardUpdate } from "../../../../shared/stores/agent.store";
import { CharacterCardUpdateModal } from "./CharacterCardUpdateModal";

const storedEntry: PendingCardUpdate = {
  id: "run-1:mira",
  characterId: "mira",
  characterName: "Mira",
  updates: [
    {
      characterId: "mira",
      action: "update",
      field: "description",
      oldText: "keeps the lantern",
      newText: "keeps the lantern and the harbor key",
      reason: "She took the key.",
    },
  ],
  agentName: "Card Evolution Auditor",
  timestamp: 1,
  runId: "run-1",
  updateIndexes: [0],
};

let root: Root | null = null;

function renderDialog(onClose = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<CharacterCardUpdateModal open onClose={onClose} />));
  return onClose;
}

function button(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((element) =>
    element.textContent?.trim().startsWith(name),
  );
  if (!match) throw new Error(`No "${name}" button`);
  return match as HTMLButtonElement;
}

const queuedIds = () => useAgentStore.getState().pendingCardUpdates.map((entry) => entry.id);

describe("CharacterCardUpdateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.getState().clearPendingCardUpdates();
    useAgentStore.getState().enqueuePendingCardUpdate(storedEntry);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("approves through the stored decision, writing the edit inside the field, and moves on", async () => {
    cardReviews.approveCardEvolutionReview.mockImplementationOnce(async (_entry, apply: () => Promise<void>) => {
      await apply();
      return "applied";
    });
    const onClose = renderDialog();

    await act(async () => button("Approve").click());

    expect(cardReviews.approveCardEvolutionReview).toHaveBeenCalledWith(storedEntry, expect.any(Function));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mira",
        data: expect.objectContaining({ description: "Mira keeps the lantern and the harbor key." }),
      }),
    );
    expect(queuedIds()).toEqual([]);
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses to record overlapping edits as applied when one can no longer find its text", async () => {
    const overlapping: PendingCardUpdate = {
      ...storedEntry,
      updates: [
        { ...storedEntry.updates[0]!, oldText: "keeps the lantern", newText: "guards the lamp" },
        { ...storedEntry.updates[0]!, oldText: "the lantern", newText: "the old lantern" },
      ],
    };
    useAgentStore.getState().clearPendingCardUpdates();
    useAgentStore.getState().enqueuePendingCardUpdate(overlapping);
    cardReviews.approveCardEvolutionReview.mockImplementationOnce(async (_entry, apply: () => Promise<void>) => {
      await apply();
      return "applied";
    });
    renderDialog();

    await act(async () => button("Approve").click());

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(queuedIds()).toEqual(["run-1:mira"]);
    expect(document.body.textContent).toContain("Two of these edits change the same description text");
  });

  it("keeps the proposals and shows the error when approving fails", async () => {
    cardReviews.approveCardEvolutionReview.mockRejectedValueOnce(new Error("Mira's card update is being applied"));
    const onClose = renderDialog();

    await act(async () => button("Approve").click());

    expect(queuedIds()).toEqual(["run-1:mira"]);
    expect(document.body.textContent).toContain("Mira's card update is being applied");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves a rejection, and keeps the proposals with the error when it can't", async () => {
    cardReviews.rejectCardEvolutionReview.mockRejectedValueOnce(new Error("storage offline"));
    const onClose = renderDialog();

    await act(async () => button("Reject").click());
    expect(queuedIds()).toEqual(["run-1:mira"]);
    expect(document.body.textContent).toContain("storage offline");

    cardReviews.rejectCardEvolutionReview.mockResolvedValueOnce("rejected");
    await act(async () => button("Reject").click());
    expect(cardReviews.rejectCardEvolutionReview).toHaveBeenLastCalledWith(storedEntry);
    expect(queuedIds()).toEqual([]);
    expect(onClose).toHaveBeenCalled();
  });
});
