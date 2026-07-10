// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeMergedMessageCycle } from "./merged-message-cycle-clock";

describe("merged message cycle clock", () => {
  const unsubscribers: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shares one interval across subscribers and clears it after the last unsubscribe", () => {
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeMergedMessageCycle(first);
    const unsubscribeSecond = subscribeMergedMessageCycle(second);
    unsubscribers.push(unsubscribeFirst, unsubscribeSecond);

    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(2_000);
    expect(first).toHaveBeenCalledWith(1);
    expect(second).toHaveBeenCalledWith(1);

    unsubscribeFirst();
    expect(vi.getTimerCount()).toBe(1);

    unsubscribeSecond();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("synchronizes a late subscriber to the current tick before the next sequential tick", () => {
    const first = vi.fn();
    const unsubscribeFirst = subscribeMergedMessageCycle(first);
    unsubscribers.push(unsubscribeFirst);
    vi.advanceTimersByTime(2_000);

    const late = vi.fn();
    const unsubscribeLate = subscribeMergedMessageCycle(late);
    unsubscribers.push(unsubscribeLate);

    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(2_000);
    expect(late).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenLastCalledWith(2);
  });

  it("suspends while hidden and resumes once without leaking its visibility listener", () => {
    let visibilityState: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const subscriber = vi.fn();

    const unsubscribe = subscribeMergedMessageCycle(subscriber);
    unsubscribers.push(unsubscribe);

    expect(vi.getTimerCount()).toBe(0);
    expect(addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(2_000);
    expect(subscriber).toHaveBeenCalledWith(1);

    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
