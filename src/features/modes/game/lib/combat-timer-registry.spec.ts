import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCombatTimerRegistry } from "./combat-timer-registry";

describe("createCombatTimerRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears pending callbacks before they run", () => {
    const registry = createCombatTimerRegistry();
    const callback = vi.fn();

    registry.schedule(callback, 100);
    registry.clearAll();
    vi.advanceTimersByTime(100);

    expect(callback).not.toHaveBeenCalled();
    expect(registry.pendingCount()).toBe(0);
  });

  it("forgets callbacks after they run", () => {
    const registry = createCombatTimerRegistry();
    const callback = vi.fn();

    registry.schedule(callback, 100);

    expect(registry.pendingCount()).toBe(1);

    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(registry.pendingCount()).toBe(0);
  });
});
