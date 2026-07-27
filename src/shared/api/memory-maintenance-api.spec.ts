import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemoryCleanupApplyRequest,
  MemoryCleanupUndoRequest,
} from "../../engine/contracts/types/memory-maintenance";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("memoryMaintenanceApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ ok: true });
  });

  it("routes cleanup apply and undo through focused commands", async () => {
    const { memoryMaintenanceApi } = await import("./memory-maintenance-api");
    const apply = {
      version: 1,
      scope: { kind: "chat", id: "chat-1" },
      proposals: [],
    } satisfies MemoryCleanupApplyRequest;
    const undo = {
      scope: apply.scope,
      batchId: "cleanup-batch-1",
    } satisfies MemoryCleanupUndoRequest;

    await memoryMaintenanceApi.apply(apply);
    await memoryMaintenanceApi.undo(undo);

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "memory_cleanup_apply", {
      body: apply,
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "memory_cleanup_undo", {
      body: undo,
    });
  });
});
