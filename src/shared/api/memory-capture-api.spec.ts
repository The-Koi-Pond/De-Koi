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
      .mockResolvedValueOnce({ id: "job-1", status: "processing" });
    const { memoryCaptureApi } = await import("./memory-capture-api");

    await expect(memoryCaptureApi.acquireWorker("browser-a")).resolves.toBe("lease-a");
    await expect(memoryCaptureApi.acquireWorker("browser-a", "lease-a")).resolves.toBe("lease-a");
    await memoryCaptureApi.releaseWorker("browser-a", "lease-a");
    await memoryCaptureApi.updateJob("lease-a", "job-1", { status: "processing" });

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
  });
});
