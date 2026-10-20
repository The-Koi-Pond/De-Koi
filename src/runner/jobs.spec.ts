import { describe, expect, it } from "vitest";
import { FINISHED_JOB_TTL_MS, JobRegistry, type RunnerEvent } from "./jobs";

async function collect(iterator: AsyncGenerator<RunnerEvent>): Promise<string[]> {
  const seen: string[] = [];
  for await (const event of iterator) seen.push(String(event.data));
  return seen;
}

describe("runner job registry", () => {
  it("replays what a job produced so far, then follows live events to the end", async () => {
    const registry = new JobRegistry();
    const job = registry.create("job-1", "chat-1", { chatId: "chat-1" });
    registry.push(job, { type: "token", data: "a" });
    const following = collect(registry.follow(job));
    registry.push(job, { type: "token", data: "b" });
    await Promise.resolve();
    registry.push(job, { type: "token", data: "c" });
    registry.finish(job, "done");
    expect(await following).toEqual(["a", "b", "c"]);
  });

  it("resumes from a given event so a reconnecting client gets no repeats or gaps", async () => {
    const registry = new JobRegistry();
    const job = registry.create("job-1", "chat-1", {});
    for (const data of ["a", "b", "c"]) registry.push(job, { type: "token", data });
    registry.finish(job, "done");
    expect(await collect(registry.follow(job, undefined, 2))).toEqual(["c"]);
    expect(await collect(registry.follow(job, undefined, 99))).toEqual([]);
  });

  it("allows one running job per chat and forgets finished jobs after a while", () => {
    let now = 1_000;
    const registry = new JobRegistry(() => now);
    const job = registry.create("job-1", "chat-1", {});
    expect(registry.runningForChat("chat-1")?.id).toBe("job-1");
    registry.finish(job, "done");
    expect(registry.runningForChat("chat-1")).toBeNull();
    expect(registry.get("job-1")?.status).toBe("done");
    now += FINISHED_JOB_TTL_MS + 1;
    expect(registry.get("job-1")).toBeNull();
  });
});
