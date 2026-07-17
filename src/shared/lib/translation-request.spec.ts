import { describe, expect, it, vi } from "vitest";
import { createTranslationRequest } from "./translation-request";

describe("translation request ownership", () => {
  it("aborts a cancelled request and rejects its late result", async () => {
    let resolve!: (value: string) => void;
    const execute = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const request = createTranslationRequest(execute);

    const pending = request.run();
    request.cancel();
    resolve("late translation");

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(request.signal.aborted).toBe(true);
  });

  it("returns a completed result when the request still owns completion", async () => {
    const request = createTranslationRequest(async () => "translated");

    await expect(request.run()).resolves.toEqual({ status: "completed", value: "translated" });
  });

  it("does not classify provider failures as user cancellation", async () => {
    const failure = new Error("provider unavailable");
    const request = createTranslationRequest(async () => {
      throw failure;
    });

    await expect(request.run()).rejects.toBe(failure);
  });
});
