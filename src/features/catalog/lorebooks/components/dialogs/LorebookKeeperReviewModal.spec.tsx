import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const keeperReviews = vi.hoisted(() => ({
  approveLorebookKeeperProposal: vi.fn(),
  rejectLorebookKeeperProposal: vi.fn(),
}));

vi.mock("../../lib/lorebook-keeper-updates", () => keeperReviews);

import { useAgentStore, type PendingLorebookUpdate } from "../../../../../shared/stores/agent.store";
import { LorebookKeeperReviewModal } from "./LorebookKeeperReviewModal";

const proposal: PendingLorebookUpdate = {
  id: "run-1:0",
  chatId: "chat-1",
  runId: "run-1",
  updateIndex: 0,
  lorebookId: "book-1",
  lorebookName: "Pond lore",
  action: "create",
  entryId: null,
  entryName: "Archivist koi",
  content: "The Archivist koi is two hundred years old.",
  newFacts: [],
  keys: ["Archivist"],
  tag: "",
  reason: "New lore from the reply",
  agentName: "Lorebook Keeper",
  timestamp: 1,
};

let root: Root | null = null;

function renderDialog(onClose = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <LorebookKeeperReviewModal open onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  return onClose;
}

function button(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((element) => element.textContent?.trim() === name);
  if (!match) throw new Error(`No "${name}" button`);
  return match as HTMLButtonElement;
}

const queuedIds = () => useAgentStore.getState().pendingLorebookUpdates.map((entry) => entry.id);

describe("LorebookKeeperReviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.getState().clearPendingLorebookUpdates();
    useAgentStore.getState().enqueuePendingLorebookUpdate(proposal);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("keeps the proposal and shows the error when approving it fails", async () => {
    keeperReviews.approveLorebookKeeperProposal.mockRejectedValueOnce(new Error("storage offline"));
    const onClose = renderDialog();

    await act(async () => button("Approve").click());

    expect(keeperReviews.approveLorebookKeeperProposal).toHaveBeenCalledWith(proposal);
    expect(queuedIds()).toEqual(["run-1:0"]);
    expect(document.body.textContent).toContain("storage offline");
    expect(onClose).not.toHaveBeenCalled();

    keeperReviews.approveLorebookKeeperProposal.mockResolvedValueOnce("applied");
    await act(async () => button("Approve").click());
    expect(queuedIds()).toEqual([]);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the proposal and shows the error when rejecting it fails", async () => {
    keeperReviews.rejectLorebookKeeperProposal.mockRejectedValueOnce(new Error("being applied in another tab"));
    renderDialog();

    await act(async () => button("Reject").click());

    expect(keeperReviews.rejectLorebookKeeperProposal).toHaveBeenCalledWith(proposal);
    expect(queuedIds()).toEqual(["run-1:0"]);
    expect(document.body.textContent).toContain("being applied in another tab");
  });

  it("moves on from a proposal another tab already decided", async () => {
    keeperReviews.approveLorebookKeeperProposal.mockResolvedValueOnce("already-reviewed");
    renderDialog();

    await act(async () => button("Approve").click());

    expect(queuedIds()).toEqual([]);
  });
});
