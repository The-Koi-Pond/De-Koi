import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import {
  beginForegroundGeneration,
  deferUntilForegroundGenerationCompletes,
  foregroundGenerationActive,
  interruptWhenForegroundGenerationStarts,
} from "./background-generation-coordinator";

describe("background generation coordinator", () => {
  it("aborts each registered background operation once when foreground generation starts", () => {
    const storage = {} as StorageGateway;
    const workerKey = {};
    const controller = new AbortController();
    const reason = new Error("foreground generation started");
    const unregister = interruptWhenForegroundGenerationStarts(storage, workerKey, controller, reason);

    const releaseA = beginForegroundGeneration(storage);
    const releaseB = beginForegroundGeneration(storage);
    unregister();

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);

    releaseA();
    releaseB();
  });

  it("resumes every deferred worker once after the outermost foreground lease ends", () => {
    const storage = {} as StorageGateway;
    const captureKey = {};
    const maintenanceKey = {};
    const capture = vi.fn();
    const maintenance = vi.fn();
    const releaseA = beginForegroundGeneration(storage);
    const releaseB = beginForegroundGeneration(storage);

    deferUntilForegroundGenerationCompletes(storage, captureKey, capture);
    deferUntilForegroundGenerationCompletes(storage, maintenanceKey, maintenance);
    releaseA();
    releaseA();

    expect(foregroundGenerationActive(storage)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(maintenance).not.toHaveBeenCalled();

    releaseB();

    expect(foregroundGenerationActive(storage)).toBe(false);
    expect(capture).toHaveBeenCalledOnce();
    expect(maintenance).toHaveBeenCalledOnce();
  });

  it("replaces a deferred callback only for the same worker key", () => {
    const storage = {} as StorageGateway;
    const workerKey = {};
    const first = vi.fn();
    const latest = vi.fn();
    const release = beginForegroundGeneration(storage);

    deferUntilForegroundGenerationCompletes(storage, workerKey, first);
    deferUntilForegroundGenerationCompletes(storage, workerKey, latest);
    release();

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
});
