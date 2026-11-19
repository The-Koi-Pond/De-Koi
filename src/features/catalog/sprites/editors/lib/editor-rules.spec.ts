import { describe, expect, it } from "vitest";

import { idleHint, readoutText, strokeChangedText, wandRemovedText } from "./cleanup-text";
import { EMPTY_HISTORY, HISTORY_BYTE_BUDGET, recordChange, redoChange, undoChange, type EditHistory } from "./history";
import type { RgbaPicture } from "./picture";
import { removeWandArea } from "./wand";
import { fitZoom, MAX_ZOOM, MIN_ZOOM, pixelUnderPointer, wheelZoom, zoomIn, zoomOut, zoomPercent } from "./view";

function picture(value: number, width = 2, height = 2): RgbaPicture {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(value) };
}

describe("history", () => {
  it("keeps 12 undo steps: 13 changes, then only 12 undos work", () => {
    let history: EditHistory = EMPTY_HISTORY;
    let current = picture(0);
    for (let step = 1; step <= 13; step += 1) {
      history = recordChange(history, current);
      current = picture(step);
    }
    expect(history.undo).toHaveLength(12);
    const values: number[] = [];
    for (let step = 0; step < 13; step += 1) {
      const move = undoChange(history, current);
      if (!move) break;
      history = move.history;
      current = move.picture;
      values.push(current.data[0]);
    }
    // The first change's "before" (0) was dropped; undo stops at the picture after the first change.
    expect(values).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(undoChange(history, current)).toBeNull();
    expect(history.redo).toHaveLength(12);
  });

  it("redo steps forward and a new change clears the redo list", () => {
    let history = recordChange(recordChange(EMPTY_HISTORY, picture(0)), picture(1));
    let current = picture(2);
    const back = undoChange(history, current)!;
    history = back.history;
    current = back.picture;
    expect(current.data[0]).toBe(1);
    const forward = redoChange(history, current)!;
    expect(forward.picture.data[0]).toBe(2);
    expect(forward.history.undo.map((step) => step.data[0])).toEqual([0, 1]);
    expect(redoChange(forward.history, forward.picture)).toBeNull();

    history = recordChange(back.history, back.picture);
    expect(history.redo).toEqual([]);
  });

  it("caps undo and redo together at the memory budget, never below 3 undo steps (decision 12)", () => {
    // History only weighs pictures by their bytes, so these stand-ins don't allocate them.
    const sized = (megabytes: number, marker: number) =>
      ({
        width: 1,
        height: 1,
        data: { byteLength: megabytes * 1024 * 1024, 0: marker },
      }) as unknown as RgbaPicture;
    // 64 MB per copy: four fit in 256 MB.
    let history: EditHistory = EMPTY_HISTORY;
    for (let step = 0; step < 6; step += 1) history = recordChange(history, sized(64, step));
    expect(history.undo.map((step) => step.data[0])).toEqual([2, 3, 4, 5]);
    expect(history.undo.length * 64 * 1024 * 1024).toBeLessThanOrEqual(HISTORY_BYTE_BUDGET);

    // 128 MB per copy: the budget would keep two, the floor keeps three.
    history = EMPTY_HISTORY;
    for (let step = 0; step < 5; step += 1) history = recordChange(history, sized(128, step));
    expect(history.undo.map((step) => step.data[0])).toEqual([2, 3, 4]);

    // A 1024×1536 sprite (6 MB) keeps the full 12 + 12.
    history = EMPTY_HISTORY;
    for (let step = 0; step < 14; step += 1) history = recordChange(history, sized(6, step));
    expect(history.undo).toHaveLength(12);
  });

  it("never drops redo steps for the budget: two undos and two redos on 100 MB pictures end on the newest", () => {
    const sized = (marker: number) =>
      ({ width: 1, height: 1, data: { byteLength: 100 * 1024 * 1024, 0: marker } }) as unknown as RgbaPicture;
    let history: EditHistory = EMPTY_HISTORY;
    let current = sized(0);
    for (let step = 1; step <= 4; step += 1) {
      history = recordChange(history, current);
      current = sized(step);
    }
    expect(history.undo.map((step) => step.data[0])).toEqual([1, 2, 3]);
    for (const move of [undoChange, undoChange, redoChange, redoChange]) {
      const next = move(history, current)!;
      history = next.history;
      current = next.picture;
    }
    expect(current.data[0]).toBe(4);
    expect(history.redo).toEqual([]);
    expect(history.undo.length).toBeGreaterThanOrEqual(3);
  });
});

describe("wand limits", () => {
  const solid = (width: number, height: number): RgbaPicture => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(200),
  });

  it("changes nothing for a start point outside the picture or not a whole number", () => {
    const picture = solid(4, 3);
    const settings = { tolerance: 36, strong: true, softness: 100, feather: 100 };
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [4, 0],
      [0, 3],
      [Number.NaN, 1],
      [1, Number.NaN],
      [1.5, 1],
      [Number.POSITIVE_INFINITY, 0],
    ]) {
      const result = removeWandArea(picture, x, y, settings);
      expect(result.removed).toBe(0);
      expect(result.picture).toBe(picture);
    }
    expect(removeWandArea(picture, 3, 0, settings).removed).toBe(12);
  });

  it("allocates about 20 bytes per pixel for a click with the widest bands", () => {
    // A 512×512 picture: a dark disc on a light background, so the kept edge and the halo are long.
    const width = 512;
    const picture = solid(width, width);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((x - 256) ** 2 + (y - 256) ** 2 < 150 ** 2)
          picture.data.fill(40, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
    let allocated = 0;
    const counting = <T extends object>(type: T) =>
      new Proxy(type, {
        construct(target, args, newTarget) {
          const made = Reflect.construct(target as never, args, newTarget) as ArrayBufferView;
          allocated += made.byteLength;
          return made;
        },
      });
    const originals = { Uint8Array, Uint8ClampedArray, Int32Array, Float64Array };
    Object.assign(globalThis, {
      Uint8Array: counting(Uint8Array),
      Uint8ClampedArray: counting(Uint8ClampedArray),
      Int32Array: counting(Int32Array),
      Float64Array: counting(Float64Array),
    });
    let removed = 0;
    try {
      removed = removeWandArea(picture, 2, 2, { tolerance: 128, strong: true, softness: 100, feather: 100 }).removed;
    } finally {
      Object.assign(globalThis, originals);
    }
    expect(removed).toBeGreaterThan(width * width * 0.7);
    expect(allocated / (width * width)).toBeLessThanOrEqual(24);
  });
});

describe("zoom and the pointer", () => {
  it("steps by 1.25 on the buttons and 1.15 on the wheel within 12.5% to 800%", () => {
    const shown: string[] = [];
    let zoom = 1;
    for (const step of [zoomIn, zoomIn, zoomIn, zoomOut]) {
      zoom = step(zoom);
      shown.push(zoomPercent(zoom));
    }
    expect(shown).toEqual(["125%", "156%", "195%", "156%"]);
    expect(wheelZoom(1, -100)).toBeCloseTo(1.15);
    expect(wheelZoom(1, 100)).toBeCloseTo(1 / 1.15);
    expect(wheelZoom(1, 0)).toBeCloseTo(1 / 1.15);
    expect(zoomIn(7)).toBe(MAX_ZOOM);
    expect(zoomOut(0.13)).toBe(MIN_ZOOM);
  });

  it("fits inside the stage less 32 px, never above 100%", () => {
    expect(fitZoom({ width: 1000, height: 800 }, { width: 96, height: 96 })).toBe(1);
    // The recorded 1024×1536 sprite fitted at 34% in a 557 px tall stage, shown 350×525.
    const big = fitZoom({ width: 1100, height: 557 }, { width: 1024, height: 1536 });
    expect(zoomPercent(big)).toBe("34%");
    expect(1536 * big).toBeCloseTo(525);
    expect(fitZoom({ width: 10, height: 10 }, { width: 8192, height: 8192 })).toBe(MIN_ZOOM);
  });

  it("maps a pointer to the pixel under it, rounding down, and nothing outside the canvas", () => {
    const shown = { left: 100, top: 50, width: 150, height: 150 };
    const size = { width: 96, height: 96 };
    expect(pixelUnderPointer({ x: 100 + 60.5 * 1.5625, y: 50 + 20.5 * 1.5625 }, shown, size)).toEqual({ x: 60, y: 20 });
    expect(pixelUnderPointer({ x: 250, y: 200 }, shown, size)).toEqual({ x: 95, y: 95 });
    expect(pixelUnderPointer({ x: 99, y: 60 }, shown, size)).toBeNull();
    expect(pixelUnderPointer({ x: 260, y: 60 }, shown, size)).toBeNull();
  });
});

describe("status texts", () => {
  it("words wand results, strokes and the readout like the recordings", () => {
    const settings = { tolerance: 36, strong: false, softness: 55, feather: 12 };
    expect(wandRemovedText(6082, settings, [240, 240, 240, 255])).toBe(
      "6,082 px removed with wand (55% softness, 12% feather) from rgba(240, 240, 240, 255)",
    );
    expect(wandRemovedText(6251, { ...settings, strong: true, softness: 0, feather: 0 }, [240, 240, 240, 255])).toBe(
      "6,251 px removed with strong wand (0% softness, 0% feather) from rgba(240, 240, 240, 255)",
    );
    expect(strokeChangedText("clean", 36)).toBe("36 px target-cleaned");
    expect(strokeChangedText("blur", 373)).toBe("373 px edge-blurred");
    expect(strokeChangedText("paint", 2085)).toBe("2,085 px painted");
    expect(readoutText(null)).toBe("Move over the sprite to sample pixels");
    expect(readoutText({ x: 46, y: 44, rgba: [200, 60, 90, 253] })).toBe("x 46, y 44 · rgba(200, 60, 90, 253)");
  });

  it("gives each tool its own idle hint (decision 9)", () => {
    expect(idleHint("wand", "color")).toBe("Click the background to remove it.");
    expect(idleHint("clean", "color")).toBe("Drag over leftover background to clean it.");
    expect(idleHint("erase", "color")).toBe("Drag to erase.");
    expect(idleHint("brush", "color")).toBe("Drag to paint.");
    expect(idleHint("brush", "restore")).toBe("Drag to bring back the original.");
    expect(idleHint("blur", "color")).toBe("Drag along jagged edges to smooth them.");
    expect(idleHint("pan", "color")).toBe("Drag to move the view.");
  });
});
