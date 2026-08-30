import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invokeTauri: vi.fn() }));

vi.mock("./tauri-client", () => ({ invokeTauri: mocks.invokeTauri }));

describe("memoryCaptureApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
  });

  it("routes worker leases and fenced job updates through focused commands", async () => {
    mocks.invokeTauri
      .mockResolvedValueOnce({ acquired: true, leaseId: "lease-a" })
      .mockResolvedValueOnce({ acquired: true, leaseId: "lease-a" })
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ id: "job-1", status: "processing" })
      .mockResolvedValueOnce({ id: "memory-1" })
      .mockResolvedValueOnce({ id: "memory-1", content: "updated" })
      .mockResolvedValueOnce({ id: "message-1", extra: { memoryCapture: { status: "completed" } } })
      .mockResolvedValueOnce({ rebuilt: 1 });
    const { memoryCaptureApi } = await import("./memory-capture-api");

    await expect(memoryCaptureApi.acquireWorker("browser-a")).resolves.toBe("lease-a");
    await expect(memoryCaptureApi.acquireWorker("browser-a", "lease-a")).resolves.toBe("lease-a");
    await memoryCaptureApi.releaseWorker("browser-a", "lease-a");
    await memoryCaptureApi.updateJob("lease-a", "job-1", { status: "processing" });
    const knowledgeEdges = [{ memoryId: "memory-1", holder: { kind: "character", id: "alice" } }] as never;
    await memoryCaptureApi.createMemory("lease-a", { id: "memory-1" } as never, knowledgeEdges);
    await memoryCaptureApi.updateMemory("lease-a", "memory-1", { content: "updated" }, knowledgeEdges);
    await memoryCaptureApi.patchMessageExtra("lease-a", "message-1", {
      memoryCapture: { status: "completed" },
    });
    await memoryCaptureApi.rebuildIndex("lease-a", { scope: { kind: "chat", id: "chat-1" } });

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "memory_capture_worker_acquire", {
      body: { workerId: "browser-a" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "memory_capture_worker_acquire", {
      body: { workerId: "browser-a", leaseId: "lease-a" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(3, "memory_capture_worker_release", {
      body: { workerId: "browser-a", leaseId: "lease-a" },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(4, "memory_capture_job_update", {
      body: { leaseId: "lease-a", jobId: "job-1", patch: { status: "processing" } },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(5, "memory_capture_memory_create", {
      body: { leaseId: "lease-a", memory: { id: "memory-1" }, knowledgeEdges },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(6, "memory_capture_memory_update", {
      body: { leaseId: "lease-a", memoryId: "memory-1", patch: { content: "updated" }, knowledgeEdges },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(7, "memory_capture_message_extra_patch", {
      body: { leaseId: "lease-a", messageId: "message-1", patch: { memoryCapture: { status: "completed" } } },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(8, "memory_capture_index_rebuild", {
      body: { leaseId: "lease-a", query: { scope: { kind: "chat", id: "chat-1" } } },
    });
  });
});
