import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invokeTauri: vi.fn() }));

vi.mock("./tauri-client", () => ({ invokeTauri: mocks.invokeTauri }));

describe("storyConsolidationRuntimeApi", () => {
  beforeEach(() => mocks.invokeTauri.mockReset());

  it("routes fenced job updates and atomic projection commits", async () => {
    mocks.invokeTauri.mockResolvedValueOnce({ id: "job-1", status: "processing" }).mockResolvedValueOnce({
      memory: { id: "episode-1" },
      job: { id: "job-1", status: "completed" },
    });
    const { storyConsolidationRuntimeApi } = await import("./story-consolidation-runtime-api");

    await storyConsolidationRuntimeApi.updateJob("lease-1", "job-1", { status: "processing" });
    await storyConsolidationRuntimeApi.commitProjection("lease-1", "job-1", { id: "episode-1" } as never);

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "story_consolidation_job_update", {
      body: { leaseId: "lease-1", jobId: "job-1", patch: { status: "processing" } },
    });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(2, "story_consolidation_projection_commit", {
      body: { leaseId: "lease-1", jobId: "job-1", memory: { id: "episode-1" } },
    });
  });
});
