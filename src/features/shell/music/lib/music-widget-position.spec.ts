import { describe, expect, it } from "vitest";

import { clampMusicWidgetPosition, defaultMusicWidgetPosition } from "./music-widget-position";

describe("music widget position", () => {
  it("defaults above the composer area near the left edge", () => {
    expect(defaultMusicWidgetPosition({ width: 1440, height: 900 }, { width: 352, height: 132 })).toEqual({
      x: 16,
      y: 128,
    });
  });

  it("clamps dragged positions inside the viewport", () => {
    expect(
      clampMusicWidgetPosition({ x: 2000, y: -40 }, { width: 390, height: 720 }, { width: 352, height: 180 }),
    ).toEqual({ x: 30, y: 8 });
  });
});
