import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemoryCleanupApplyRequest,
  MemoryCleanupApplyRequestV2,
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

  it("routes the automatic worker lease through focused commands", async () => {
    mocks.invokeTauri
      .mockResolvedValueOnce({ acquired: true, leaseId: "lease-a" })
      .mockResolvedValueOnce({ acquired: true, leaseId: "lease-a" })
      .mockResolvedValueOnce({ released: true });
    const { memoryMaintenanceApi } = await import("./memory-maintenance-api");

    await expect(memoryMaintenanceApi.acquireWorker("browser-a")).resolves.toBe("lease-a");
    await expect(memoryMaintenanceApi.acquireWorker("browser-a", "lease-a")).resolves.toBe("lease-a");
    await memoryMaintenanceApi.releaseWorker("browser-a", "lease-a");

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "memory_maintenance_worker_acquire", {
      body: { workerId: "browser-a" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "memory_maintenance_worker_acquire", {
      body: { workerId: "browser-a", leaseId: "lease-a" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(3, "memory_maintenance_worker_release", {
      body: { workerId: "browser-a", leaseId: "lease-a" },
    });
  });

  it("routes fenced maintenance job updates through a focused command", async () => {
    const { memoryMaintenanceApi } = await import("./memory-maintenance-api");

    await memoryMaintenanceApi.updateJob("lease-a", "job-1", { status: "processing" });

    expect(mocks.invokeTauri).toHaveBeenCalledWith("memory_maintenance_job_update", {
      body: { leaseId: "lease-a", jobId: "job-1", patch: { status: "processing" } },
    });
  });

  it("sends an explicit canonical scene target", async () => {
    const { memoryMaintenanceApi } = await import("./memory-maintenance-api");
    const body = {
      version: 2,
      target: { store: "canonical", scope: { kind: "scene", id: "scene-1" } },
      proposals: [
        {
          id: "clarify-memory-1",
          type: "clarify",
          sourceIds: ["memory-1"],
          expected: {
            "memory-1": {
              content: "He does not want to talk about it.",
              status: "active",
              updatedAt: "2026-07-30T10:00:00.000Z",
              pinned: false,
              userEdited: false,
            },
          },
          replacement: {
            content: "Pierrot does not want to discuss the circus accident.",
            kind: "fact",
          },
          reason: "Context clarification",
          selected: true,
          estimatedTokensBefore: 9,
          estimatedTokensAfter: 10,
        },
      ],
    } satisfies MemoryCleanupApplyRequestV2;

    await memoryMaintenanceApi.apply(body);

    expect(mocks.invokeTauri).toHaveBeenCalledWith("memory_cleanup_apply", { body });
  });
});
