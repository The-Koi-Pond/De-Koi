import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemoryCleanupPreview,
  MemoryCleanupScope,
  MemoryCleanupSource,
} from "../../../../engine/contracts/types/memory-maintenance";
import { useMemoryCleanup } from "./use-memory-cleanup";

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

function source(id: string): MemoryCleanupSource {
  return {
    id,
    scope: { kind: "chat", id: "chat-1" },
    content: `${id} content`,
    kind: "fact",
    status: "active",
    origin: "automatic",
    confidence: 0.8,
    messageIds: [],
    sourceChatIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    pinned: false,
    userEdited: false,
  };
}

function preview(scope: MemoryCleanupScope): MemoryCleanupPreview {
  return {
    version: 1,
    scope,
    proposals: [
      {
        id: "proposal-1",
        type: "combine",
        sourceIds: ["memory-1", "memory-2"],
        expected: {},
        replacement: { content: "Combined memory", kind: "fact" },
        reason: "Overlapping detail",
        selected: true,
        estimatedTokensBefore: 10,
        estimatedTokensAfter: 4,
      },
      {
        id: "proposal-2",
        type: "shorten",
        sourceIds: ["memory-3"],
        expected: {},
        replacement: { content: "Short memory", kind: "fact" },
        reason: "Shorter wording",
        selected: true,
        estimatedTokensBefore: 9,
        estimatedTokensAfter: 3,
      },
    ],
    beforeCount: 3,
    afterCount: 2,
    estimatedTokensBefore: 19,
    estimatedTokensAfter: 7,
    protectedCount: 0,
    deferredCandidateCount: 0,
  };
}

describe("useMemoryCleanup", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useMemoryCleanup>;
  let props: {
    scope: MemoryCleanupScope;
    sources: MemoryCleanupSource[];
    resolveConnectionId: () => Promise<string>;
    onChanged: () => Promise<void>;
  };

  function Harness() {
    current = useMemoryCleanup(props);
    return null;
  }

  function render() {
    act(() => {
      root.render(<Harness />);
    });
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      scope: { kind: "chat", id: "chat-1" },
      sources: [source("memory-1"), source("memory-2"), source("memory-3")],
      resolveConnectionId: vi.fn(async () => "connection-1"),
      onChanged: vi.fn(async () => undefined),
    };
    mocks.analyze.mockReset();
    mocks.apply.mockReset();
    mocks.undo.mockReset();
    mocks.analyze.mockImplementation(async ({ scope }: { scope: MemoryCleanupScope }) => preview(scope));
    mocks.apply.mockResolvedValue({
      batchId: "cleanup-batch-1",
      combined: 1,
      shortened: 0,
      superseded: 2,
      created: 1,
    });
    mocks.undo.mockResolvedValue({
      batchId: "cleanup-batch-1",
      restored: 2,
      inactivated: 1,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("discards a preview when the owner changes", async () => {
    render();
    await act(async () => current.analyze());
    expect(current.preview?.scope.id).toBe("chat-1");

    props = {
      ...props,
      scope: { kind: "chat", id: "chat-2" },
      sources: [],
    };
    render();

    expect(current.preview).toBeNull();
    await expect(current.apply()).rejects.toThrow("Analyze memories again");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("applies only selected proposals and exposes one-batch undo", async () => {
    render();
    await act(async () => current.analyze());
    act(() => current.toggleProposal("proposal-2", false));
    await act(async () => current.apply());

    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: [expect.objectContaining({ id: "proposal-1" })],
      }),
    );
    expect(current.lastBatchId).toBe("cleanup-batch-1");

    await act(async () => current.undo());
    expect(mocks.undo).toHaveBeenCalledWith({
      scope: { kind: "chat", id: "chat-1" },
      batchId: "cleanup-batch-1",
    });
    expect(current.lastBatchId).toBeNull();
  });

  it("does not report a successful old-owner apply as an error after navigation", async () => {
    let finishApply!: (value: {
      batchId: string;
      combined: number;
      shortened: number;
      superseded: number;
      created: number;
    }) => void;
    mocks.apply.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishApply = resolve;
        }),
    );
    const oldOwnerChanged = vi.fn(async () => undefined);
    props = { ...props, onChanged: oldOwnerChanged };
    render();
    await act(async () => current.analyze());

    let applyPromise!: Promise<unknown>;
    act(() => {
      applyPromise = current.apply();
    });
    props = {
      ...props,
      scope: { kind: "chat", id: "chat-2" },
      sources: [],
      onChanged: vi.fn(async () => undefined),
    };
    render();
    await act(async () => {
      finishApply({
        batchId: "cleanup-batch-old-owner",
        combined: 1,
        shortened: 0,
        superseded: 2,
        created: 1,
      });
      await applyPromise;
    });

    expect(oldOwnerChanged).toHaveBeenCalledOnce();
    expect(current.phase).toBe("idle");
    expect(current.error).toBeNull();
  });
});
