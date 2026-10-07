import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries, type ConversationSummaryBackfillResult } from "./auto-summary.service";
import { beginForegroundGeneration } from "../../../../generation/background-generation-coordinator";
import { createFakeBackgroundJobs } from "../../../../generation/background-job-queue.fake";
import {
  cancelConversationSummaryBackfill,
  queueConversationSummaryBackfill,
  resumeQueuedConversationSummaries,
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

  describe("on a runtime that stores background jobs", () => {
    const jobId = "conversation-summary:chat-1";

    function durableHarness(
      chats: Record<string, Record<string, unknown>> = { "chat-1": { id: "chat-1", mode: "conversation" } },
    ) {
      const fake = createFakeBackgroundJobs();
      const storage = {
        backgroundJobs: fake.gateway,
        get: vi.fn(async (entity: string, id: string) => (entity === "chats" ? (chats[id] ?? null) : null)),
      } as unknown as StorageGateway;
      return { fake, deps: { storage, llm: {} as LlmGateway } };
    }

    it("stores the summary pass, then runs it with the stored connection and time zone", async () => {
      const { fake, deps } = durableHarness();
      mockedBackfill.mockResolvedValue(EMPTY_RESULT);

      await expect(
        queueConversationSummaryBackfill(deps, {
          chatId: " chat-1 ",
          connectionId: "connection-1",
          timeZone: "America/New_York",
        }),
      ).resolves.toBe(true);

      await vi.waitFor(() => expect(fake.finished).toEqual([{ jobId, outcome: "done", error: null }]));
      expect(mockedBackfill).toHaveBeenCalledWith(deps, {
        chatId: "chat-1",
        connectionId: "connection-1",
        timeZone: "America/New_York",
        maxMissingDays: 1,
        signal: expect.any(AbortSignal),
      });
      expect(fake.jobs.size).toBe(0);
    });

    it("queues it again when a reply interrupts it, and runs it once that reply is done", async () => {
      const { fake, deps } = durableHarness();
      let runs = 0;
      mockedBackfill.mockImplementation(async (_deps, input) => {
        runs += 1;
        if (runs > 1) return EMPTY_RESULT;
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
        return EMPTY_RESULT;
      });

      await queueConversationSummaryBackfill(deps, { chatId: "chat-1" });
      await vi.waitFor(() => expect(mockedBackfill).toHaveBeenCalledTimes(1));
      // The user sends a reply in this chat.
      const releaseReply = beginForegroundGeneration(deps.storage);
      cancelConversationSummaryBackfill(deps.storage, "chat-1");

      await vi.waitFor(() => expect(fake.finished).toHaveLength(1));
      expect(fake.jobs.get(jobId)?.status).toBe("queued");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockedBackfill).toHaveBeenCalledTimes(1);

      releaseReply();
      await vi.waitFor(() => expect(mockedBackfill).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(fake.jobs.size).toBe(0));
    });

    it("retries a pass that fails instead of dropping it", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { fake, deps } = durableHarness();
      mockedBackfill.mockRejectedValue(new Error("provider unavailable"));

      await queueConversationSummaryBackfill(deps, { chatId: "chat-1" });

      await vi.waitFor(() =>
        expect(fake.finished).toEqual([{ jobId, outcome: "retry", error: "provider unavailable" }]),
      );
      expect(fake.jobs.get(jobId)?.status).toBe("retryable");
    });

    it("finishes a queued pass for a deleted chat without running it", async () => {
      const { fake, deps } = durableHarness({});
      await fake.gateway.enqueue({ queue: "conversation-summary", key: "chat-gone", chatId: "chat-gone", payload: {} });

      resumeQueuedConversationSummaries(deps);

      await vi.waitFor(() =>
        expect(fake.finished).toEqual([{ jobId: "conversation-summary:chat-gone", outcome: "done", error: null }]),
      );
      expect(mockedBackfill).not.toHaveBeenCalled();
    });

    it("leaves which chats get summaries to the summarizer, whatever field holds the chat's mode", async () => {
      const { fake, deps } = durableHarness({ "chat-legacy": { id: "chat-legacy", chatMode: "conversation" } });
      mockedBackfill.mockResolvedValue(EMPTY_RESULT);
      await fake.gateway.enqueue({
        queue: "conversation-summary",
        key: "chat-legacy",
        chatId: "chat-legacy",
        payload: {},
      });

      resumeQueuedConversationSummaries(deps);

      await vi.waitFor(() =>
        expect(fake.finished).toEqual([{ jobId: "conversation-summary:chat-legacy", outcome: "done", error: null }]),
      );
      expect(mockedBackfill).toHaveBeenCalledWith(deps, expect.objectContaining({ chatId: "chat-legacy" }));
    });

    it("reports that it could not store the pass on a runtime without background jobs", async () => {
      await expect(queueConversationSummaryBackfill(harness(), { chatId: "chat-1" })).resolves.toBe(false);
      expect(mockedBackfill).not.toHaveBeenCalled();
    });
  });
});
