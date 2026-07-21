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
  it("deduplicates a running chat and starts the next same-chat job only after completion", async () => {
    const storage = {} as StorageGateway;
    const first = deferred<void>();
    const firstRun = vi.fn(() => first.promise);
    const secondRun = vi.fn(async () => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    try {
      expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: firstRun })).toBe(true);
      expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: secondRun })).toBe(false);
      await vi.waitFor(() => expect(firstRun).toHaveBeenCalledOnce());
      expect(secondRun).not.toHaveBeenCalled();

      first.resolve();
      await vi.waitFor(() => expect(debug).toHaveBeenCalledWith("[generation] lorebook keeper backfill completed", { chatId: "chat-1" }));

      expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-1", run: secondRun })).toBe(true);
      await vi.waitFor(() => expect(secondRun).toHaveBeenCalledOnce());
    } finally {
      debug.mockRestore();
    }
  });

  it("contains a failed chat job without blocking another chat or later retries", async () => {
    const storage = {} as StorageGateway;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const otherChatRun = vi.fn(async () => undefined);
    const retryRun = vi.fn(async () => undefined);

    try {
      expect(
        scheduleLorebookKeeperBackfill({
          storage,
          chatId: "chat-failed",
          run: async () => {
            throw new Error("storage unavailable");
          },
        }),
      ).toBe(true);
      expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-healthy", run: otherChatRun })).toBe(true);

      await vi.waitFor(() =>
        expect(warning).toHaveBeenCalledWith("[generation] lorebook keeper backfill failed", {
          chatId: "chat-failed",
          error: "storage unavailable",
        }),
      );
      await vi.waitFor(() => expect(otherChatRun).toHaveBeenCalledOnce());

      expect(scheduleLorebookKeeperBackfill({ storage, chatId: "chat-failed", run: retryRun })).toBe(true);
      await vi.waitFor(() => expect(retryRun).toHaveBeenCalledOnce());
    } finally {
      warning.mockRestore();
      debug.mockRestore();
    }
  });
});
