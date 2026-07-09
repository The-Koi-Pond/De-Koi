import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries, type ConversationSummaryBackfillResult } from "./auto-summary.service";
import {
  cancelConversationSummaryBackfill,
  scheduleConversationSummaryBackfill,
} from "./conversation-summary-background";

vi.mock("./auto-summary.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auto-summary.service")>();
  return { ...original, backfillConversationSummaries: vi.fn() };
});

const EMPTY_RESULT: ConversationSummaryBackfillResult = {
  generatedDays: [],
  consolidatedWeeks: [],
  generatedDaySummaries: {},
  consolidatedWeekSummaries: {},
  failedDays: [],
  failedWeeks: [],
  missingDayCount: 0,
  processedDayCount: 0,
  remainingMissingDayCount: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  return {
    storage: {} as StorageGateway,
    llm: {} as LlmGateway,
  };
}

const mockedBackfill = vi.mocked(backfillConversationSummaries);

afterEach(() => {
  mockedBackfill.mockReset();
  vi.restoreAllMocks();
});

describe("conversation summary background coordinator", () => {
  it("coalesces same-chat scheduling and limits backfill to one missing day", async () => {
    const deps = harness();
    const pending = deferred<ConversationSummaryBackfillResult>();
    mockedBackfill.mockReturnValue(pending.promise);

    scheduleConversationSummaryBackfill(deps, {
      chatId: " chat-1 ",
      connectionId: "connection-1",
      timeZone: "America/New_York",
    });
    scheduleConversationSummaryBackfill(deps, {
      chatId: "chat-1",
      connectionId: "connection-1",
      timeZone: "America/New_York",
    });

    expect(mockedBackfill).toHaveBeenCalledTimes(1);
    expect(mockedBackfill).toHaveBeenCalledWith(deps, {
      chatId: "chat-1",
      connectionId: "connection-1",
      timeZone: "America/New_York",
      maxMissingDays: 1,
      signal: expect.any(AbortSignal),
    });

    pending.resolve(EMPTY_RESULT);
    await pending.promise;
  });

  it("aborts the active same-chat worker when foreground generation preempts it", async () => {
    const deps = harness();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let observedSignal: AbortSignal | undefined;
    mockedBackfill.mockImplementation(async (_deps, input) => {
      observedSignal = input.signal;
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
      return EMPTY_RESULT;
    });

    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });
    expect(observedSignal?.aborted).toBe(false);

    cancelConversationSummaryBackfill(deps.storage, "chat-1");

    expect(observedSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(mockedBackfill).toHaveBeenCalledTimes(1));
    expect(warning).not.toHaveBeenCalled();
  });

  it("replaces an aborted worker before it settles without letting old cleanup clear the replacement", async () => {
    const deps = harness();
    const first = deferred<ConversationSummaryBackfillResult>();
    const replacement = deferred<ConversationSummaryBackfillResult>();
    mockedBackfill.mockReturnValueOnce(first.promise).mockReturnValueOnce(replacement.promise);

    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });
    const firstSignal = mockedBackfill.mock.calls[0]?.[1].signal;
    cancelConversationSummaryBackfill(deps.storage, "chat-1");
    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });

    const replacementSignal = mockedBackfill.mock.calls[1]?.[1].signal;
    expect(mockedBackfill).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(true);
    expect(replacementSignal).not.toBe(firstSignal);
    expect(replacementSignal?.aborted).toBe(false);

    first.resolve(EMPTY_RESULT);
    await first.promise;
    await Promise.resolve();
    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });

    expect(mockedBackfill).toHaveBeenCalledTimes(2);

    replacement.resolve(EMPTY_RESULT);
    await replacement.promise;
  });

  it("reports non-abort failures without rejecting the caller", async () => {
    const deps = harness();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedBackfill.mockRejectedValue(new Error("provider unavailable"));

    expect(() => scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" })).not.toThrow();

    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "[generation] conversation summary background backfill failed",
        expect.objectContaining({ chatId: "chat-1", error: "provider unavailable" }),
      ),
    );
  });

  it("reports each resolved day and week failure without transcript content", async () => {
    const deps = harness();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedBackfill.mockResolvedValue({
      ...EMPTY_RESULT,
      failedDays: [{ date: "08.07.2026", error: "day provider unavailable" }],
      failedWeeks: [{ weekKey: "2026-W27", error: "week parse failed" }],
    });

    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });

    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(2));
    expect(warning).toHaveBeenNthCalledWith(1, "[generation] conversation summary background item failed", {
      chatId: "chat-1",
      stage: "day",
      identifier: "08.07.2026",
      error: "day provider unavailable",
    });
    expect(warning).toHaveBeenNthCalledWith(2, "[generation] conversation summary background item failed", {
      chatId: "chat-1",
      stage: "week",
      identifier: "2026-W27",
      error: "week parse failed",
    });
  });
});
