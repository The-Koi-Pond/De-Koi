import { describe, expect, it, vi } from "vitest";

import { scheduleTranscriptBottomLock } from "./transcript-scroll-geometry";

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
});
