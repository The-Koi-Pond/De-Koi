import { describe, expect, it, vi } from "vitest";

import { createChatSetupStartGate, runChatSetupStart } from "./chat-setup-start";

describe("runChatSetupStart", () => {
  it("returns a visible failure when metadata persistence rejects", async () => {
    const finish = vi.fn();

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn().mockRejectedValue(new Error("storage unavailable")),
        generateSchedules: null,
        finish,
      }),
    ).resolves.toEqual({ ok: false, message: "storage unavailable" });
    expect(finish).not.toHaveBeenCalled();
  });

  it("finishes exactly once after metadata and optional schedule work complete", async () => {
    const finish = vi.fn();
    const generateSchedules = vi.fn().mockResolvedValue(undefined);

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn().mockResolvedValue(undefined),
        generateSchedules,
        finish,
      }),
    ).resolves.toEqual({ ok: true });
    expect(generateSchedules).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("refreshes status blurbs after setup data is ready and before finishing", async () => {
    const events: string[] = [];

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn(async () => {
          events.push("metadata");
        }),
        generateSchedules: vi.fn(async () => {
          events.push("schedules");
        }),
        refreshStatusMessages: vi.fn(async () => {
          events.push("statuses");
        }),
        finish: () => {
          events.push("finish");
        },
      }),
    ).resolves.toEqual({ ok: true });

    expect(events).toEqual(["metadata", "schedules", "statuses", "finish"]);
  });

  it("finishes the chat and reports when status blurb refresh fails", async () => {
    const error = new Error("status provider unavailable");
    const finish = vi.fn();
    const reportStatusRefreshFailure = vi.fn();

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn().mockResolvedValue(undefined),
        generateSchedules: null,
        refreshStatusMessages: vi.fn().mockRejectedValue(error),
        reportStatusRefreshFailure,
        finish,
      }),
    ).resolves.toEqual({ ok: true });

    expect(reportStatusRefreshFailure).toHaveBeenCalledWith(error);
    expect(finish).toHaveBeenCalledOnce();
  });

  it("rejects concurrent activation before a slow setup completes", async () => {
    let releaseMetadata!: () => void;
    const metadataPending = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const finish = vi.fn();
    const persistMetadata = vi.fn(() => metadataPending);
    const start = createChatSetupStartGate();
    const input = { persistMetadata, generateSchedules: null, finish };

    const first = start(input);
    await expect(start(input)).resolves.toEqual({ ok: false, busy: true });
    releaseMetadata();
    await expect(first).resolves.toEqual({ ok: true });

    expect(persistMetadata).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
