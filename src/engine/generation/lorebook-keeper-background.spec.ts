import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { scheduleLorebookKeeperBackfill } from "./lorebook-keeper-background";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("scheduleLorebookKeeperBackfill", () => {
  it("serializes a same-chat follow-up and coalesces further requests to the latest run", async () => {
    const storage = {} as StorageGateway;
    const first = deferred<void>();
    const firstRun = vi.fn(() => first.promise);
    const supersededRun = vi.fn(async () => undefined);
    const latestRun = vi.fn(async () => undefined);
    expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: firstRun })).toBe(true);
    expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: supersededRun })).toBe(true);
    expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: latestRun })).toBe(true);
    await vi.waitFor(() => expect(firstRun).toHaveBeenCalledOnce());
    expect(supersededRun).not.toHaveBeenCalled();
    expect(latestRun).not.toHaveBeenCalled();

    first.resolve();
    await vi.waitFor(() => expect(latestRun).toHaveBeenCalledOnce());
    expect(supersededRun).not.toHaveBeenCalled();
  });

  it("keeps success and failure silent by default without leaking identifiers or errors", async () => {
    const storage = {} as StorageGateway;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    try {
      expect(
        scheduleLorebookKeeperBackfill({ storage, chatId: "private-chat-success", run: async () => undefined }),
      ).toBe(true);
      expect(
        scheduleLorebookKeeperBackfill({
          storage,
          chatId: "private-chat-failed",
          run: async () => {
            throw new Error("secret token and private path");
          },
        }),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(info).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      warning.mockRestore();
      debug.mockRestore();
    }
  });

  it("emits only sanitized opt-in completion diagnostics and contains reporter failures", async () => {
    const storage = {} as StorageGateway;
    const diagnostics: unknown[] = [];
    const reporter = vi.fn((diagnostic: unknown) => {
      diagnostics.push(diagnostic);
      if (diagnostics.length === 1) throw new Error("reporter failure with secret details");
    });
    const successTimes = [10, 25];
    const failureTimes = [40, 70];
    const retryRun = vi.fn(async () => undefined);

    expect(
      scheduleLorebookKeeperBackfill({
        storage,
        chatId: "private-chat-success",
        run: async () => undefined,
        onDiagnostic: reporter,
        now: () => successTimes.shift() ?? 25,
      }),
    ).toBe(true);
    expect(
      scheduleLorebookKeeperBackfill({
        storage,
        chatId: "private-chat-failure",
        run: async () => {
          throw new Error("secret token and private path");
        },
        onDiagnostic: reporter,
        now: () => failureTimes.shift() ?? 70,
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(reporter).toHaveBeenCalledTimes(2));

    expect(diagnostics).toEqual([
      { stage: "lorebook_keeper_backfill", status: "ok", durationMs: 15, count: 1 },
      { stage: "lorebook_keeper_backfill", status: "error", durationMs: 30, count: 1 },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private-chat");
    expect(JSON.stringify(diagnostics)).not.toContain("secret token");

    expect(scheduleLorebookKeeperBackfill({ storage, chatId: "private-chat-failure", run: retryRun })).toBe(true);
    await vi.waitFor(() => expect(retryRun).toHaveBeenCalledOnce());
  });
});
