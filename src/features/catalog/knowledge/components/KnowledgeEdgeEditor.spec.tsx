import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeEdgeEditor, normalizeConfidencePercent } from "./KnowledgeEdgeEditor";

const mocks = vi.hoisted(() => ({
  edges: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(async () => undefined),
  approve: vi.fn(async () => undefined),
  invalidate: vi.fn(async () => undefined),
  toastError: vi.fn(),
}));

vi.mock("../hooks/use-knowledge-edges", () => ({
  useKnowledgeEdges: () => ({ data: mocks.edges, isLoading: false, isError: false }),
  useKnowledgeHolders: () => ({
    data: [
      { kind: "world", id: "world", name: "World truth" },
      { kind: "character", id: "char-1", name: "Mira" },
    ],
    isLoading: false,
  }),
  useKnowledgeEdgeActions: () => ({
    upsert: { mutateAsync: mocks.upsert, isPending: false },
    approve: { mutateAsync: mocks.approve, isPending: false },
    invalidate: { mutateAsync: mocks.invalidate, isPending: false },
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

describe("KnowledgeEdgeEditor", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.edges = [];
    mocks.upsert.mockClear();
    mocks.approve.mockClear();
    mocks.invalidate.mockClear();
    mocks.toastError.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
  });

  function renderEditor() {
    act(() => {
      root = createRoot(container!);
      root.render(<KnowledgeEdgeEditor memoryId="memory-1" />);
    });
  }

  it("warns before classification and saves an explicit assignment", async () => {
    renderEditor();
    expect(container?.textContent).toContain("Legacy scope");
    expect(container?.textContent).toContain("first active assignment switches this memory to explicit access");

    const holder = container!.querySelector<HTMLSelectElement>('select[aria-label="Knowledge holder"]')!;
    const stance = container!.querySelector<HTMLSelectElement>('select[aria-label="Knowledge stance"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(holder, "character:char-1");
      holder.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(stance, "believes");
      stance.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const assign = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Assign"),
    );
    await act(async () => assign?.click());

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "memory-1",
        holder: { kind: "character", id: "char-1" },
        stance: "believes",
        status: "active",
      }),
    );
  });

  it("shows provenance and exposes approve and reject controls for a proposal", async () => {
    mocks.edges = [
      {
        id: "edge-1",
        memoryId: "memory-1",
        holder: { kind: "character", id: "char-1" },
        stance: "suspects",
        status: "proposed",
        provenance: [
          {
            kind: "import",
            author: "system",
            sourceChatId: "chat-1",
            messageIds: ["message-1"],
            createdAt: "2026-08-30T12:00:00Z",
          },
        ],
      },
    ];
    renderEditor();
    expect(container?.textContent).toContain("import · system");

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Approve proposed knowledge edge"]')?.click(),
    );
    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Reject proposed knowledge edge"]')?.click(),
    );
    expect(mocks.approve).toHaveBeenCalledWith("edge-1");
    expect(mocks.invalidate).toHaveBeenCalledWith({ edgeId: "edge-1", reason: "proposal_rejected" });
  });

  it("clamps confidence to the storage contract", async () => {
    renderEditor();
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Confidence percent"]')!;
    const assign = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Assign"),
    )!;

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "150");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => assign.click());
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ confidence: 1 }));

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "-20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => assign.click());
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ confidence: 0 }));
  });

  it("rejects non-numeric confidence before mutation", () => {
    expect(() => normalizeConfidencePercent("not-a-number")).toThrow("Confidence must be a number from 0 to 100.");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
