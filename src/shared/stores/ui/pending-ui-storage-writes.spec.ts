// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPendingUiStorageWrites } from "./pending-ui-storage-writes";
import { createDebouncedUiStorage } from "./persistence";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("pending UI storage writes", () => {
  // The CI failure: a save was still waiting when the test environment (and localStorage) went away.
  it("throws once localStorage is gone if a waiting save is left on its timer", () => {
    vi.useFakeTimers();
    createDebouncedUiStorage()!.setItem("ui-teardown-probe", { state: { sidebarOpen: true }, version: 1 });
    vi.stubGlobal("localStorage", undefined);

    expect(() => vi.advanceTimersByTime(1_000)).toThrow();
  });

  it("saves a waiting write right away and leaves no timer behind", () => {
    vi.useFakeTimers();
    createDebouncedUiStorage()!.setItem("ui-teardown-probe", { state: { sidebarOpen: true }, version: 1 });

    flushPendingUiStorageWrites();

    expect(JSON.parse(localStorage.getItem("ui-teardown-probe")!)).toEqual({
      state: { sidebarOpen: true },
      version: 1,
    });
    vi.stubGlobal("localStorage", undefined);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
  });

  it("does nothing when no save is waiting", () => {
    createDebouncedUiStorage();
    expect(() => flushPendingUiStorageWrites()).not.toThrow();
  });
});
