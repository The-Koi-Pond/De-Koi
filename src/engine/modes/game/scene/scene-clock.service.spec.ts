import { describe, expect, it } from "vitest";
import { resolveSceneClockUpdate } from "./scene-clock.service";

describe("resolveSceneClockUpdate", () => {
  it("uses elapsed minutes as the scene clock authority instead of also advancing timeOfDay", () => {
    const result = resolveSceneClockUpdate({
      timeOfDay: "evening",
      elapsedMinutes: 5,
    });

    expect(result.shouldAdvanceTimeOfDay).toBe(false);
    expect(result.timeOfDay).toBe("evening");
    expect(result.elapsedMinutes).toBe(5);
  });

  it("allows timeOfDay to advance the clock when no elapsed-time estimate is present", () => {
    const result = resolveSceneClockUpdate({
      timeOfDay: "night",
      elapsedMinutes: null,
    });

    expect(result.shouldAdvanceTimeOfDay).toBe(true);
    expect(result.timeOfDay).toBe("night");
    expect(result.elapsedMinutes).toBeNull();
  });

  it("treats a zero-minute estimate as an explicit elapsed-time authority", () => {
    const result = resolveSceneClockUpdate({
      timeOfDay: "morning",
      elapsedMinutes: 0,
    });

    expect(result.shouldAdvanceTimeOfDay).toBe(false);
    expect(result.elapsedMinutes).toBe(0);
  });
});
