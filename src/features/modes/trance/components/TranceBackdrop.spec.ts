import { describe, expect, it } from "vitest";
import { trancePalette } from "./TranceBackdrop";

describe("trancePalette", () => {
  it("goes darker going deep and brightens through the wake-up count", () => {
    const down = trancePalette({ kind: "down" });
    const deep = trancePalette({ kind: "deep" });
    const start = trancePalette({ kind: "wake", progress: 0 });
    const middle = trancePalette({ kind: "wake", progress: 0.5 });
    const end = trancePalette({ kind: "wake", progress: 1 });
    const brightness = (hex: string) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);
    expect(brightness(deep.bg)).toBeLessThan(brightness(down.bg));
    expect(start.bg).toBe(deep.bg);
    expect(brightness(middle.bg)).toBeGreaterThan(brightness(start.bg));
    expect(brightness(end.bg)).toBeGreaterThan(brightness(middle.bg));
    expect(trancePalette({ kind: "wake", progress: 7 }).bg).toBe(end.bg);
  });
});
