import { describe, expect, it, vi } from "vitest";

import {
  resolveTranscriptScrollState,
  scheduleTranscriptBottomLock,
  shouldFollowTranscriptBottom,
} from "./transcript-scroll-geometry";

describe("transcript scroll geometry", () => {
  it("keeps locking to the latest bottom while transcript height settles", () => {
    const frames: FrameRequestCallback[] = [];
    let nextFrameId = 1;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return nextFrameId++;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const transcript = { scrollHeight: 120, scrollTop: 0 };
    const writeBottom = vi.fn(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });

    const cancel = scheduleTranscriptBottomLock(writeBottom);

    expect(writeBottom).toHaveBeenCalledTimes(1);
    expect(transcript.scrollTop).toBe(120);

    transcript.scrollHeight = 260;
    frames.shift()?.(16);

    expect(writeBottom).toHaveBeenCalledTimes(2);
    expect(transcript.scrollTop).toBe(260);

    transcript.scrollHeight = 420;
    frames.shift()?.(32);

    expect(writeBottom).toHaveBeenCalledTimes(3);
    expect(transcript.scrollTop).toBe(420);

    cancel();

    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(cancelFrame).toHaveBeenCalledWith(2);
  });

  it("stops queued bottom locks when the write declines continuation", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    let shouldContinue = true;
    const writeBottom = vi.fn(() => shouldContinue);

    scheduleTranscriptBottomLock(writeBottom);

    expect(writeBottom).toHaveBeenCalledTimes(1);

    shouldContinue = false;
    frames.shift()?.(16);
    frames.shift()?.(32);

    expect(writeBottom).toHaveBeenCalledTimes(2);
  });
  it("does not let forced or optimistic bottom jumps bypass user scroll-away", () => {
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: true,
        isNearBottom: false,
        isOptimisticTail: false,
        isStreamingWithUserTail: false,
        userScrolledAway: true,
      }),
    ).toBe(false);
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: false,
        isNearBottom: false,
        isOptimisticTail: true,
        isStreamingWithUserTail: false,
        userScrolledAway: true,
      }),
    ).toBe(false);
  });
});

describe("transcript scroll state", () => {
  it("keeps streaming upward scrolls disengaged even when still near bottom", () => {
    const state = resolveTranscriptScrollState({
      metrics: { scrollHeight: 1000, scrollTop: 860, clientHeight: 100 },
      lastScrollTop: 900,
      wasUserScrolledAway: false,
      userScrolledAt: 0,
      isStreaming: true,
      now: 1000,
    });

    expect(state.isNearBottom).toBe(true);
    expect(state.userScrolledAway).toBe(true);
    expect(state.userScrolledAt).toBe(1000);
    expect(state.lastScrollTop).toBe(860);
  });

  it("keeps auto-scroll disengaged on stale near-bottom noise", () => {
    const state = resolveTranscriptScrollState({
      metrics: { scrollHeight: 1000, scrollTop: 920, clientHeight: 100 },
      lastScrollTop: 920,
      wasUserScrolledAway: true,
      userScrolledAt: 500,
      isStreaming: true,
      now: 900,
    });

    expect(state.isNearBottom).toBe(true);
    expect(state.userScrolledAway).toBe(true);
    expect(state.userScrolledAt).toBe(500);
    expect(state.lastScrollTop).toBe(920);
  });

  it("re-engages auto-scroll after a confirmed return toward the bottom", () => {
    const state = resolveTranscriptScrollState({
      metrics: { scrollHeight: 1000, scrollTop: 920, clientHeight: 100 },
      lastScrollTop: 860,
      wasUserScrolledAway: true,
      userScrolledAt: 500,
      isStreaming: true,
      now: 900,
    });

    expect(state.isNearBottom).toBe(true);
    expect(state.userScrolledAway).toBe(false);
    expect(state.userScrolledAt).toBe(500);
    expect(state.lastScrollTop).toBe(920);
  });
  it("does not force a streaming user-tail transcript after the user scrolls away", () => {
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: false,
        isNearBottom: true,
        isOptimisticTail: false,
        isStreamingWithUserTail: true,
        userScrolledAway: true,
      }),
    ).toBe(false);
  });

  it("still honors explicit and optimistic bottom jumps", () => {
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: false,
        isNearBottom: false,
        isOptimisticTail: true,
        isStreamingWithUserTail: false,
        userScrolledAway: false,
      }),
    ).toBe(true);
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: true,
        isNearBottom: false,
        isOptimisticTail: false,
        isStreamingWithUserTail: false,
        userScrolledAway: false,
      }),
    ).toBe(true);
  });
  it("does not let forced or optimistic bottom jumps bypass user scroll-away", () => {
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: true,
        isNearBottom: false,
        isOptimisticTail: false,
        isStreamingWithUserTail: false,
        userScrolledAway: true,
      }),
    ).toBe(false);
    expect(
      shouldFollowTranscriptBottom({
        hasFreshForcedBottomScroll: false,
        isNearBottom: false,
        isOptimisticTail: true,
        isStreamingWithUserTail: false,
        userScrolledAway: true,
      }),
    ).toBe(false);
  });
});
