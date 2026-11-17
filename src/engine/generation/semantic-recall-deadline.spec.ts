import { afterEach, describe, expect, it, vi } from "vitest";
import { settleByDeadline } from "./semantic-recall-deadline";

describe("settleByDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the late value once the deadline passes", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);
    const settled = settleByDeadline(never, Date.now() + 1_200, () => "late");
    await vi.advanceTimersByTimeAsync(1_199);
    let done = false;
    void settled.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toBe("late");
  });

  it("returns the work when it settles before the deadline", async () => {
    await expect(settleByDeadline(Promise.resolve("on time"), Date.now() + 1_000, () => "late")).resolves.toBe(
      "on time",
    );
  });

  it("prefers work that already settled even when the deadline has passed", async () => {
    await expect(settleByDeadline(Promise.resolve("ready"), Date.now() - 5_000, () => "late")).resolves.toBe("ready");
  });

  it("waits for the work when there is no deadline", async () => {
    vi.useFakeTimers();
    let resolveWork!: (value: string) => void;
    const settled = settleByDeadline(new Promise<string>((resolve) => (resolveWork = resolve)), null, () => "late");
    await vi.advanceTimersByTimeAsync(60_000);
    resolveWork("eventually");
    await expect(settled).resolves.toBe("eventually");
  });
});
