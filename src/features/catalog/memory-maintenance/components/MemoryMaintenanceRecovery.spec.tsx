// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryMaintenanceRecovery } from "./MemoryMaintenanceRecovery";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  undo: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { list: api.list },
}));
vi.mock("../../../../shared/api/memory-maintenance-api", () => ({
  memoryMaintenanceApi: { undo: api.undo },
}));

const target = { store: "canonical" as const, scope: { kind: "character" as const, id: "char-1" } };

describe("MemoryMaintenanceRecovery", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.list.mockReset();
    api.undo.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is silent for healthy no-op maintenance", async () => {
    api.list.mockResolvedValue([
      {
        id: "job",
        targetKey: "canonical:character:char-1",
        status: "completed",
        lastResult: null,
      },
    ]);

    await act(async () => {
      root.render(<MemoryMaintenanceRecovery targets={[target]} onChanged={vi.fn()} />);
    });

    expect(api.list).toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("offers optional undo after automatic changes", async () => {
    api.list.mockResolvedValue([
      {
        id: "job",
        targetKey: "canonical:character:char-1",
        target,
        status: "completed",
        updatedAt: "2026-07-30T10:00:00.000Z",
        lastBatchId: "batch-1",
        lastResult: { discarded: 2, combined: 1, superseded: 3, created: 1 },
      },
    ]);
    api.undo.mockResolvedValue({ batchId: "batch-1", restored: 3, inactivated: 1 });
    const onChanged = vi.fn();
    await act(async () => {
      root.render(<MemoryMaintenanceRecovery targets={[target]} onChanged={onChanged} />);
    });

    expect(container.textContent).toContain("Memory maintenance combined 1 and removed 2.");
    const undo = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Undo",
    );
    await act(async () => undo?.click());

    expect(api.undo).toHaveBeenCalledWith({ version: 2, target, batchId: "batch-1" });
    expect(onChanged).toHaveBeenCalled();
  });
});
