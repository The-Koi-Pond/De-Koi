export type TranscriptScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function readTranscriptScrollMetrics(element: HTMLElement): TranscriptScrollMetrics {
  return {
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
  };
}

function isNearTranscriptBottom(metrics: TranscriptScrollMetrics, thresholdPx = 150): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < thresholdPx;
}

export type TranscriptScrollStateInput = {
  metrics: TranscriptScrollMetrics;
  lastScrollTop: number;
  wasUserScrolledAway: boolean;
  userScrolledAt: number;
  isStreaming: boolean;
  now?: number;
  nearBottomThresholdPx?: number;
  upwardScrollThresholdPx?: number;
  reengageDelayMs?: number;
};

export type TranscriptScrollState = {
  isNearBottom: boolean;
  userScrolledAway: boolean;
  userScrolledAt: number;
  lastScrollTop: number;
};

export function resolveTranscriptScrollState({
  metrics,
  lastScrollTop,
  wasUserScrolledAway,
  userScrolledAt,
  isStreaming,
  now = Date.now(),
  nearBottomThresholdPx = 150,
  upwardScrollThresholdPx = 10,
  reengageDelayMs = 300,
}: TranscriptScrollStateInput): TranscriptScrollState {
  const isNearBottom = isNearTranscriptBottom(metrics, nearBottomThresholdPx);
  const scrolledUp = metrics.scrollTop < lastScrollTop - upwardScrollThresholdPx;
  let nextUserScrolledAway = wasUserScrolledAway;
  let nextUserScrolledAt = userScrolledAt;

  const scrolledTowardBottomDuringStreaming =
    isStreaming && metrics.scrollTop > lastScrollTop + upwardScrollThresholdPx;

  if (scrolledUp) {
    nextUserScrolledAway = true;
    nextUserScrolledAt = now;
  } else if (isNearBottom && scrolledTowardBottomDuringStreaming && now - userScrolledAt > reengageDelayMs) {
    nextUserScrolledAway = false;
  }

  return {
    isNearBottom,
    userScrolledAway: nextUserScrolledAway,
    userScrolledAt: nextUserScrolledAt,
    lastScrollTop: metrics.scrollTop,
  };
}

export type TranscriptFollowBottomInput = {
  hasFreshForcedBottomScroll: boolean;
  isNearBottom: boolean;
  isOptimisticTail: boolean;
  isStreamingWithUserTail: boolean;
  tailMessageChanged?: boolean;
  userScrolledAway: boolean;
};

export function shouldFollowTranscriptBottom({
  hasFreshForcedBottomScroll,
  isNearBottom,
  isOptimisticTail,
  isStreamingWithUserTail,
  tailMessageChanged = false,
  userScrolledAway,
}: TranscriptFollowBottomInput): boolean {
  if (hasFreshForcedBottomScroll || isOptimisticTail || tailMessageChanged) return true;
  if (userScrolledAway) return false;
  return isStreamingWithUserTail || isNearBottom;
}

export type TranscriptWindowRevealInput = {
  hasOlderWindow: boolean;
  isLoadingMore: boolean;
  tailMessageChanged: boolean;
  streamingStarted: boolean;
  isOptimisticTail: boolean;
  hasFreshForcedBottomScroll: boolean;
  userScrolledAway: boolean;
};

export function shouldRevealLatestTranscriptWindow({
  hasOlderWindow,
  isLoadingMore,
  tailMessageChanged,
  streamingStarted,
  isOptimisticTail,
  hasFreshForcedBottomScroll,
  userScrolledAway,
}: TranscriptWindowRevealInput): boolean {
  if (!hasOlderWindow || isLoadingMore) return false;
  if (isOptimisticTail || hasFreshForcedBottomScroll || tailMessageChanged) return true;
  if (userScrolledAway) return false;
  return streamingStarted;
}

export function scheduleTranscriptScrollWrite(write: () => void): () => void {
  if (typeof window === "undefined") {
    write();
    return () => {};
  }

  const frame = window.requestAnimationFrame(write);
  return () => window.cancelAnimationFrame(frame);
}

export function scheduleTranscriptBottomLock(writeBottom: () => boolean | void, frameCount = 2): () => void {
  if (writeBottom() === false) {
    return () => {};
  }

  if (typeof window === "undefined") {
    return () => {};
  }

  let cancelled = false;
  const frames: number[] = [];

  const scheduleNextFrame = (remainingFrames: number) => {
    if (remainingFrames <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (writeBottom() === false) return;
      scheduleNextFrame(remainingFrames - 1);
    });
    frames.push(frame);
  };

  scheduleNextFrame(frameCount);

  return () => {
    cancelled = true;
    frames.forEach((frame) => window.cancelAnimationFrame(frame));
  };
}

export function scrollTranscriptToBottom(element: HTMLElement): number {
  element.scrollTop = element.scrollHeight;
  return element.scrollTop;
}

export function preserveTranscriptScrollAfterPrepend(element: HTMLElement, previousScrollHeight: number): void {
  const nextScrollHeight = element.scrollHeight;
  element.scrollTop += nextScrollHeight - previousScrollHeight;
}
