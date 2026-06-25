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

export function isNearTranscriptBottom(metrics: TranscriptScrollMetrics, thresholdPx = 150): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < thresholdPx;
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
