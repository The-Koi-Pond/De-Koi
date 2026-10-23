import { describe, expect, it } from "vitest";
import { createSpeechStartDetector } from "./voice-recorder";

const LEVEL = 0.035;

/** The frame (50 ms each) on which speech counts as started, or null. */
function startFrame(levels: number[], guarded: boolean): number | null {
  const starts = createSpeechStartDetector(LEVEL);
  for (let index = 0; index < levels.length; index += 1) if (starts(levels[index]!, guarded)) return index;
  return null;
}

// Speech as a meter sees it: loud syllables with short dips between words.
const SPEECH = [0.09, 0.12, 0.02, 0.1, 0.08, 0.01, 0.11, 0.09, 0.03, 0.1, 0.12, 0.02];

describe("createSpeechStartDetector", () => {
  it("starts normal listening after a few loud frames in a row, not on a click", () => {
    expect(startFrame([0.2, 0, 0, 0, 0, 0], false)).toBeNull();
    expect(startFrame([0.04, 0.05, 0.04, 0.06], false)).toBe(3);
  });

  it("while the reply's voice plays, notices speech that dips between words within about a third of a second", () => {
    const frame = startFrame(SPEECH, true);
    expect(frame).not.toBeNull();
    expect(frame!).toBeLessThanOrEqual(6);
  });

  it("while the reply's voice plays, ignores sound only a little above the normal level (leftover echo)", () => {
    expect(
      startFrame(
        Array.from({ length: 20 }, () => 0.05),
        true,
      ),
    ).toBeNull();
  });
});
