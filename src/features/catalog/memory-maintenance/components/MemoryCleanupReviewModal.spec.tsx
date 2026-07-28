import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryCleanupPreview, MemoryCleanupSource } from "../../../../engine/contracts/types/memory-maintenance";
import { MemoryCleanupReviewModal } from "./MemoryCleanupReviewModal";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
}));

vi.mock("../../../../engine/generation/memory-cleanup", () => ({
  analyzeMemoryCleanup: mocks.analyze,
}));

vi.mock("../../../../shared/api/memory-maintenance-api", () => ({
  memoryMaintenanceApi: {
    apply: mocks.apply,
    undo: mocks.undo,
  },
}));

vi.mock("../../../../shared/api/llm-api", () => ({
  llmApi: {},
}));

vi.mock("../../../../shared/components/ui/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

const sources: MemoryCleanupSource[] = [
  {
    id: "memory-a",
    scope: { kind: "chat", id: "chat-1" },
    content: "Mira has the brass key.",
    kind: "fact",
    status: "active",
    origin: "automatic",
    confidence: 0.8,
    messageIds: [],
    sourceChatIds: [],
    createdAt: null,
    updatedAt: null,
    pinned: false,
    userEdited: false,
  },
  {
    id: "memory-b",
    scope: { kind: "chat", id: "chat-1" },
    content: "Mira keeps the brass key.",
    kind: "fact",
    status: "active",
    origin: "automatic",
    confidence: 0.9,
    messageIds: [],
    sourceChatIds: [],
    createdAt: null,
    updatedAt: null,
    pinned: false,
    userEdited: false,
  },
];

function cleanupPreview(): MemoryCleanupPreview {
  return {
    version: 1,
    scope: { kind: "chat", id: "chat-1" },
    proposals: [
      {
        id: "proposal-1",
        type: "combine",
        sourceIds: ["memory-a", "memory-b"],
        expected: {},
        replacement: { content: "Mira keeps the brass key.", kind: "fact" },
        reason: "Overlapping memories",
        selected: true,
        estimatedTokensBefore: 12,
        estimatedTokensAfter: 7,
      },
    ],
    beforeCount: 24,
    afterCount: 13,
    estimatedTokensBefore: 1200,
    estimatedTokensAfter: 700,
    deferredCandidateCount: 0,
  };
}

describe("MemoryCleanupReviewModal", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.analyze.mockReset();
    mocks.apply.mockReset();
    mocks.undo.mockReset();
    mocks.analyze.mockResolvedValue(cleanupPreview());
    mocks.apply.mockResolvedValue({
      batchId: "cleanup-batch-1",
      combined: 1,
      superseded: 2,
      created: 1,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("explains why analysis is unavailable when there are no sources", () => {
    act(() => {
      root.render(
        <MemoryCleanupReviewModal
          open
          scope={{ kind: "chat", id: "chat-1" }}
          sources={[]}
          resolveConnectionId={async () => "connection-1"}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("There are no active memories available to analyze yet.");
    const analyze = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Analyze memories"),
    );
    expect(analyze?.disabled).toBe(true);
  });

  it("shows a write-free before-and-after review before enabling apply", async () => {
    act(() => {
      root.render(
        <MemoryCleanupReviewModal
          open
          scope={{ kind: "chat", id: "chat-1" }}
          sources={sources}
          resolveConnectionId={async () => "connection-1"}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("You review every change before anything is saved.");
    expect(container.textContent).toContain(
      "Find memories that can be combined into fewer, clearer memories without losing details.",
    );
    expect(container.textContent).not.toContain("overly wordy");
    const analyze = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Analyze memories"),
    );
    await act(async () => analyze?.click());

    expect(container.textContent).toContain("24 memories");
    expect(container.textContent).toContain("13 memories");
    expect(container.textContent).toContain("Mira has the brass key.");
    expect(container.textContent).toContain("Mira keeps the brass key.");
    expect(container.textContent).not.toContain("protected memories");
    expect(container.textContent).not.toContain("will not be rewritten");
    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Apply cleanup",
    );
    expect(apply?.disabled).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("reports when active memories have no consolidation opportunity", async () => {
    mocks.analyze.mockResolvedValue({
      ...cleanupPreview(),
      proposals: [],
      beforeCount: 2,
      afterCount: 2,
      estimatedTokensBefore: 12,
      estimatedTokensAfter: 12,
    });
    act(() => {
      root.render(
        <MemoryCleanupReviewModal
          open
          scope={{ kind: "chat", id: "chat-1" }}
          sources={sources}
          resolveConnectionId={async () => "connection-1"}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
    });

    const analyze = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Analyze memories"),
    );
    await act(async () => analyze?.click());

    expect(container.textContent).toContain(
      "No consolidation opportunities found. Your memories are already distinct.",
    );
  });

  it("offers undo only after a successful apply", async () => {
    act(() => {
      root.render(
        <MemoryCleanupReviewModal
          open
          scope={{ kind: "chat", id: "chat-1" }}
          sources={sources}
          resolveConnectionId={async () => "connection-1"}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
    });
    const analyze = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Analyze memories"),
    );
    await act(async () => analyze?.click());
    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Apply cleanup",
    );
    await act(async () => apply?.click());

    expect(container.textContent).toContain("Undo cleanup");
    expect(mocks.apply).toHaveBeenCalledOnce();
  });
});
