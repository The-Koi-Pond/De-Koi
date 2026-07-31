import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { beginForegroundGeneration } from "./background-generation-coordinator";
import {
  cancelCraftAnalysis,
  cancelCraftAnalysesForForeground,
  scheduleCraftAnalysis,
} from "./craft-analysis-background";

function storageIdentity(): StorageGateway {
  return {} as StorageGateway;
}

describe("shared craft analysis scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("runs different chats independently and keeps the latest queued job per chat", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    let finish!: () => void;
    const calls: string[] = [];
    scheduleCraftAnalysis({
      storage,
      chatId: "one",
      stage: "conversation_craft_analysis",
      run: () => new Promise<void>((resolve) => { calls.push("first"); finish = resolve; }),
    });
    scheduleCraftAnalysis({
      storage,
      chatId: "two",
      stage: "narrative_craft_analysis",
      run: async () => { calls.push("other-chat"); },
    });
    await vi.runOnlyPendingTimersAsync();
    scheduleCraftAnalysis({ storage, chatId: "one", stage: "conversation_craft_analysis", run: async () => { calls.push("stale"); } });
    scheduleCraftAnalysis({ storage, chatId: "one", stage: "conversation_craft_analysis", run: async () => { calls.push("latest"); } });
    finish();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(calls).toEqual(["first", "other-chat", "latest"]);
  });

  it("waits for foreground work and foreground cancellation aborts running and pending work", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const releaseForeground = beginForegroundGeneration(storage);
    const deferred = vi.fn(async () => undefined);
    scheduleCraftAnalysis({ storage, chatId: "deferred", stage: "conversation_craft_analysis", run: deferred });
    await vi.runOnlyPendingTimersAsync();
    expect(deferred).not.toHaveBeenCalled();
    releaseForeground();
    await Promise.resolve();
    expect(deferred).toHaveBeenCalledOnce();

    let signal!: AbortSignal;
    let finish!: () => void;
    const pending = vi.fn(async () => undefined);
    scheduleCraftAnalysis({
      storage,
      chatId: "running",
      stage: "conversation_craft_analysis",
      run: (workerSignal) => new Promise<void>((resolve) => { signal = workerSignal; finish = resolve; }),
    });
    await vi.runOnlyPendingTimersAsync();
    scheduleCraftAnalysis({ storage, chatId: "running", stage: "conversation_craft_analysis", run: pending });
    cancelCraftAnalysesForForeground(storage);
    expect(signal.aborted).toBe(true);
    finish();
    await Promise.resolve();
    expect(pending).not.toHaveBeenCalled();
  });

  it("reports the supplied stage and can cancel one queued chat", async () => {
    vi.useFakeTimers();
    const storage = storageIdentity();
    const run = vi.fn(async () => undefined);
    const diagnostics: unknown[] = [];
    let tick = 10;
    scheduleCraftAnalysis({
      storage,
      chatId: "chat-1",
      stage: "conversation_craft_analysis",
      run,
      now: () => { tick += 5; return tick; },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    cancelCraftAnalysis(storage, "chat-1");
    await vi.runOnlyPendingTimersAsync();
    expect(run).not.toHaveBeenCalled();

    scheduleCraftAnalysis({
      storage,
      chatId: "chat-2",
      stage: "conversation_craft_analysis",
      run,
      now: () => { tick += 5; return tick; },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await vi.runAllTimersAsync();
    expect(diagnostics).toEqual([
      { stage: "conversation_craft_analysis", status: "ok", durationMs: 5 },
    ]);
  });
});
