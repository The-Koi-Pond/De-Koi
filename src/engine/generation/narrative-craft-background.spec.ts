import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { beginForegroundGeneration } from "./background-generation-coordinator";
import {
  cancelNarrativeCraftAnalysis,
  cancelNarrativeCraftAnalysesForForeground,
  narrativeCraftHasRecurringShape,
  scheduleNarrativeCraftAnalysis,
} from "./narrative-craft-background";

function storageIdentity(): StorageGateway {
  return {} as StorageGateway;
}

describe("Narrative Craft recurrence trigger", () => {
  it("detects the same high-confidence prose habit across different assistant turns", () => {
    expect(
      narrativeCraftHasRecurringShape(
        [
          { role: "assistant", content: "Her breath caught hard enough to stop the next word." },
          { role: "user", content: "I wait." },
        ],
        "His breath caught as the lock turned behind him.",
      ),
    ).toBe(true);
  });

  it("detects a repeated non-trivial sentence opening across assistant turns", () => {
    expect(
      narrativeCraftHasRecurringShape(
        [{ role: "assistant", content: "For a long moment, Mara studied the ruined radio." }],
        "For a long moment, the only answer was rain.",
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "one occurrence",
      messages: [{ role: "assistant", content: "Mara studies the ruined radio." }],
      response: "Her breath caught when the dial moved.",
    },
    {
      name: "two occurrences in one assistant turn",
      messages: [{ role: "assistant", content: "Mara studies the ruined radio." }],
      response: "Her breath caught. A moment later, his breath caught too.",
    },
    {
      name: "matching user prose",
      messages: [{ role: "user", content: "My breath caught when the dial moved." }],
      response: "Her breath caught when the dial moved.",
    },
    {
      name: "short common opening",
      messages: [{ role: "assistant", content: "He said no." }],
      response: "He said nothing.",
    },
  ])("does not trigger for $name", ({ messages, response }) => {
    expect(narrativeCraftHasRecurringShape(messages, response)).toBe(false);
  });
});

describe("Narrative Craft background scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers work to a later task instead of awaiting it in the foreground", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    let finish!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(scheduleNarrativeCraftAnalysis({ storage, chatId: "chat-1", run })).toBe(true);
    expect(run).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
  });

  it("waits for the shared foreground lease before starting", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const releaseForeground = beginForegroundGeneration(storage);
    const run = vi.fn(async () => undefined);

    scheduleNarrativeCraftAnalysis({ storage, chatId: "chat-1", run });
    await vi.runOnlyPendingTimersAsync();
    expect(run).not.toHaveBeenCalled();

    releaseForeground();
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
  });

  it("runs different chats independently", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    scheduleNarrativeCraftAnalysis({ storage, chatId: "chat-1", run: first });
    scheduleNarrativeCraftAnalysis({ storage, chatId: "chat-2", run: second });
    await vi.runAllTimersAsync();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("coalesces queued work per chat without running two analyses concurrently", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    let finishFirst!: () => void;
    const calls: string[] = [];

    scheduleNarrativeCraftAnalysis({
      storage,
      chatId: "chat-1",
      run: () =>
        new Promise<void>((resolve) => {
          calls.push("first");
          finishFirst = resolve;
        }),
    });
    await vi.runOnlyPendingTimersAsync();

    scheduleNarrativeCraftAnalysis({
      storage,
      chatId: "chat-1",
      run: async () => {
        calls.push("stale");
      },
    });
    scheduleNarrativeCraftAnalysis({
      storage,
      chatId: "chat-1",
      run: async () => {
        calls.push("latest");
      },
    });

    expect(calls).toEqual(["first"]);
    finishFirst();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(calls).toEqual(["first", "latest"]);
  });

  it("aborts in-flight analysis when foreground generation resumes", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    let workerSignal!: AbortSignal;
    let release!: () => void;

    scheduleNarrativeCraftAnalysis({
      storage,
      chatId: "chat-1",
      run: (signal) =>
        new Promise<void>((resolve) => {
          workerSignal = signal;
          release = resolve;
        }),
    });
    await vi.runOnlyPendingTimersAsync();

    expect(workerSignal.aborted).toBe(false);
    cancelNarrativeCraftAnalysis(storage, "chat-1");
    expect(workerSignal.aborted).toBe(true);
    release();
    await Promise.resolve();
  });

  it("aborts in-flight analyses for every chat when foreground generation resumes", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const signals: AbortSignal[] = [];
    const releases: Array<() => void> = [];

    for (const chatId of ["chat-1", "chat-2"]) {
      scheduleNarrativeCraftAnalysis({
        storage,
        chatId,
        run: (signal) =>
          new Promise<void>((resolve) => {
            signals.push(signal);
            releases.push(resolve);
          }),
      });
    }
    await vi.runOnlyPendingTimersAsync();

    cancelNarrativeCraftAnalysesForForeground(storage);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    for (const release of releases) release();
    await Promise.resolve();
  });

  it("cancels queued analysis before the worker starts", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const run = vi.fn(async () => undefined);

    scheduleNarrativeCraftAnalysis({
      storage,
      chatId: "chat-1",
      run,
    });
    cancelNarrativeCraftAnalysis(storage, "chat-1");
    await vi.runOnlyPendingTimersAsync();

    expect(run).not.toHaveBeenCalled();
  });
});
