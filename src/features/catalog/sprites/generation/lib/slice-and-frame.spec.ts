import { describe, expect, it } from "vitest";

import { setFrameEdge, ZERO_FRAME } from "./frame-limits";
import { SliceAreaError, sliceLines, spriteSliceBox, zeroSliceSettings, type SliceSettings } from "./slice-geometry";

function settings(overrides: Partial<SliceSettings> = {}): SliceSettings {
  return { ...zeroSliceSettings({ cols: 2, rows: 3 }), ...overrides };
}

/** A sheet shaped like Rust's: 512 px wide cells, 512 px high portraits, 2×3. */
const portraitSheet = { sheetWidth: 1024, sheetHeight: 1536, grid: { cols: 2, rows: 3 } };

describe("cut settings", () => {
  it("start at zero with one cut per inner line", () => {
    const zero = zeroSliceSettings({ cols: 4, rows: 3 });
    expect(zero.columnCuts).toEqual([0, 0, 0]);
    expect(zero.rowCuts).toEqual([0, 0]);
    expect(zeroSliceSettings(null).columnCuts).toEqual([]);
  });
});

describe("cut lines", () => {
  it("place the outer lines at the margin plus the nudge and inner lines evenly plus their cut", () => {
    expect(sliceLines(1024, 2, 2, 0, [3])).toEqual([20, 543, 1004]);
    expect(sliceLines(1000, 2, 0, 5, [0])).toEqual([50, 550, 1050]);
  });

  it("keep inner lines at least max(8, 3%) apart, moving forward then back", () => {
    expect(sliceLines(200, 4, 18, 0, [12, -12, 0])).toEqual([36, 92, 100, 132, 164]);
    expect(sliceLines(100, 4, 18, 0, [0, 0, 12])).toEqual([18, 34, 50, 74, 82]);
  });
});

describe("a sprite's box", () => {
  it("is the cell between its lines with no settings", () => {
    expect(spriteSliceBox({ ...portraitSheet, position: 3 }, settings())).toEqual({
      left: 512,
      top: 512,
      width: 512,
      height: 512,
    });
  });

  it("follows margins, cuts and edge crops (recorded scenario 17's settings)", () => {
    const recorded = settings({ sideMargin: 2, columnCuts: [3], cropTop: 5 });
    expect(spriteSliceBox({ ...portraitSheet, position: 0 }, recorded)).toEqual({
      left: 20,
      top: 26,
      width: 523,
      height: 486,
    });
    expect(spriteSliceBox({ ...portraitSheet, position: 5 }, recorded)).toEqual({
      left: 543,
      top: 1050,
      width: 461,
      height: 486,
    });
  });

  it("loses half the gap on each side that has a neighbour", () => {
    const gapped = settings({ columnGap: 2 });
    expect(spriteSliceBox({ ...portraitSheet, position: 0 }, gapped)).toMatchObject({ left: 0, width: 502 });
    expect(spriteSliceBox({ ...portraitSheet, position: 1 }, gapped)).toMatchObject({ left: 522, width: 502 });
  });

  it("stays inside the sheet when nudged past its edge", () => {
    const box = spriteSliceBox({ ...portraitSheet, position: 1 }, settings({ nudgeX: 10 }));
    expect(box.left + box.width).toBeLessThanOrEqual(1024);
  });

  it("fails with a worded error when nothing is left", () => {
    const greedy = settings({ cropTop: 40, cropBottom: 40, cropLeft: 40, cropRight: 40 });
    expect(() =>
      spriteSliceBox({ sheetWidth: 2, sheetHeight: 2, grid: { cols: 1, rows: 1 }, position: 0 }, greedy),
    ).toThrow(SliceAreaError);
    expect(() =>
      spriteSliceBox({ sheetWidth: 2, sheetHeight: 2, grid: { cols: 1, rows: 1 }, position: 0 }, greedy),
    ).toThrow("These cut settings leave no room for a sprite. Lower the margins, gaps or crops.");
  });
});

describe("frame limits", () => {
  it("keeps each edge between 0 and 80, anything not a number as 0", () => {
    expect(setFrameEdge(ZERO_FRAME, "left", 85).left).toBe(80);
    expect(setFrameEdge(ZERO_FRAME, "top", -5).top).toBe(0);
    expect(setFrameEdge(ZERO_FRAME, "top", Number.NaN).top).toBe(0);
  });

  it("lowers the opposite edge when a pair passes 90, never below 0", () => {
    const framed = setFrameEdge({ ...ZERO_FRAME, right: 30 }, "left", 80);
    expect(framed).toEqual({ top: 0, bottom: 0, left: 80, right: 10 });
    expect(setFrameEdge({ ...ZERO_FRAME, bottom: 20 }, "top", 10)).toEqual({ top: 10, bottom: 20, left: 0, right: 0 });
  });
});
