import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClaimedBackgroundJob } from "../capabilities/background-jobs";
import type { StorageGateway } from "../capabilities/storage";
import { beginForegroundGeneration } from "./background-generation-coordinator";
import { createBackgroundJobQueue } from "./background-job-queue";
import { createFakeBackgroundJobs } from "./background-job-queue.fake";

function setup(run: (job: ClaimedBackgroundJob) => Promise<"done" | "retry" | "failed">) {
  const fake = createFakeBackgroundJobs();
  const storage = { backgroundJobs: fake.gateway } as unknown as StorageGateway;
  const queue = createBackgroundJobQueue<{ storage: StorageGateway }>({
    queue: "continuity-director",
    run: (job) => run(job),
    timings: { heartbeatMs: 1_000, busyRetryMs: 5_000, failureRetryMs: 60_000 },
  });
  return { fake, storage, queue };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("background job queue", () => {
  it("runs a queued job once and clears it when done", async () => {
    const run = vi.fn(async () => "done" as const);
    const { fake, storage, queue } = setup(run);

    await queue.enqueue({ storage }, { key: "chat-1", chatId: "chat-1", payload: { trigger: "assistant_saved" } });

    await vi.waitFor(() => expect(fake.finished).toHaveLength(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: "continuity-director:chat-1", payload: { trigger: "assistant_saved" } }),
    );
    expect(fake.jobs.size).toBe(0);
  });

  it("records a retry instead of losing the job when its run throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, storage, queue } = setup(async () => {
      throw new Error("model unreachable");
    });

    await queue.enqueue({ storage }, { key: "chat-1", payload: {} });

    await vi.waitFor(() =>
      expect(fake.finished).toEqual([
        { jobId: "continuity-director:chat-1", outcome: "retry", error: "model unreachable" },
      ]),
    );
    expect(fake.jobs.get("continuity-director:chat-1")?.status).toBe("retryable");
    warn.mockRestore();
  });

  it("waits while another client holds the queue, then takes over once its lease lapses", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => "done" as const);
    const { fake, storage, queue } = setup(run);
    fake.holdLease("continuity-director");

    await queue.enqueue({ storage }, { key: "chat-1", payload: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    // The other tab closed without releasing; its lease lapses and this one retries.
    fake.expireLease("continuity-director");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(run).toHaveBeenCalledTimes(1);
    expect(fake.jobs.size).toBe(0);
  });

  it("picks up a job a closed tab claimed but never finished", async () => {
    const run = vi.fn(async () => "done" as const);
    const { fake, storage, queue } = setup(run);
    await fake.gateway.enqueue({ queue: "continuity-director", key: "chat-1", payload: {} });
    // A tab claimed it, then closed mid-run.
    const lease = await fake.gateway.acquireWorker("continuity-director", "closed-tab");
    await fake.gateway.claim("continuity-director", lease!);
    fake.expireLease("continuity-director");

    queue.schedule({ storage });

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2 }));
    await vi.waitFor(() => expect(fake.jobs.size).toBe(0));
  });

  it("holds off while a reply is generating, then runs", async () => {
    const run = vi.fn(async () => "done" as const);
    const { storage, queue } = setup(run);
    const release = beginForegroundGeneration(storage);

    await queue.enqueue({ storage }, { key: "chat-1", payload: {} });
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("stops claiming more jobs once a reply starts in the middle of a pass, then resumes after it", async () => {
    let release: (() => void) | null = null;
    const run = vi.fn(async (job: ClaimedBackgroundJob) => {
      // The first job is running when the user sends a reply.
      if (job.key === "chat-1") release = beginForegroundGeneration(storage);
      return "done" as const;
    });
    const { fake, storage, queue } = setup(run);
    await fake.gateway.enqueue({ queue: "continuity-director", key: "chat-1", payload: {} });
    await fake.gateway.enqueue({ queue: "continuity-director", key: "chat-2", payload: {} });

    queue.schedule({ storage });
    await vi.waitFor(() => expect(fake.finished).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1);

    release!();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ key: "chat-2" }));
  });

  it("refuses to queue on a runtime without background jobs instead of dropping the work", async () => {
    const { queue } = setup(async () => "done");
    await expect(queue.enqueue({ storage: {} as StorageGateway }, { key: "chat-1", payload: {} })).rejects.toThrow(
      /cannot store background jobs/,
    );
  });
});
