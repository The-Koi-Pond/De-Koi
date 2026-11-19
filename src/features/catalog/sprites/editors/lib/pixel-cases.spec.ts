import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import recorded from "../test-fixtures/pixel-cases.json";
import { brushRadius, stampBrush, strokeBrushLine, type BrushSettings, type Point } from "./brush";
import { copyPicture, pixelAt, type RgbaPicture } from "./picture";
import { removeWandArea, type WandSettings } from "./wand";

// Black-box recordings of the old wand and brush rules on plain RGBA (see the fixture's "about"). Every case must give
// the exact recorded picture (sha256 of the raw RGBA) and the recorded counts.

interface RecordedPicture {
  width: number;
  height: number;
  sha256: string;
  rgba: string;
}

interface WandCase {
  kind: "wand";
  picture: "A" | "B";
  clickName: string;
  click: [number, number];
  settings: WandSettings;
  removed: number;
  target: number[];
  outputSha256: string;
}

interface StrokeCase {
  kind: "stroke";
  picture: "A" | "B";
  afterWand: { click: [number, number]; settings: WandSettings } | null;
  tool: {
    mode: BrushSettings["mode"];
    size: number;
    hardness?: number;
    opacity?: number;
    color?: [number, number, number];
    tolerance?: number;
    edgeGuard?: number;
    feather?: number;
    strength?: number;
  };
  points: Point[];
  count: number;
  outputSha256: string;
}

const pictures = recorded.pictures as Record<string, RecordedPicture>;
const cases = recorded.cases as Array<WandCase | StrokeCase>;
/** Wand clicks on small random pictures, each carrying its own picture. */
const randomWandCases = recorded.randomWandCases as unknown as Array<
  Omit<WandCase, "picture" | "clickName"> & { trial: number; picture: RecordedPicture }
>;

function decode(picture: RecordedPicture): RgbaPicture {
  const data = new Uint8ClampedArray(inflateSync(Buffer.from(picture.rgba, "base64")));
  return { width: picture.width, height: picture.height, data };
}

function sha256(picture: RgbaPicture): string {
  return createHash("sha256").update(picture.data).digest("hex");
}

function strokeSettings(stroke: StrokeCase, current: RgbaPicture): BrushSettings {
  const { tool } = stroke;
  const radius = brushRadius(tool.size);
  switch (tool.mode) {
    case "erase":
    case "restore":
      return { mode: tool.mode, radius, hardness: tool.hardness!, opacity: tool.opacity! };
    case "paint":
      return { mode: "paint", radius, hardness: tool.hardness!, opacity: tool.opacity!, color: tool.color! };
    case "clean": {
      const press = stroke.points[0];
      return {
        mode: "clean",
        radius,
        target: pixelAt(current, press.x, press.y),
        tolerance: tool.tolerance!,
        edgeGuard: tool.edgeGuard!,
        feather: tool.feather!,
      };
    }
    case "blur":
      return { mode: "blur", radius, strength: tool.strength! };
  }
}

function caseName(entry: WandCase | StrokeCase, index: number): string {
  if (entry.kind === "wand") {
    const { tolerance, strong, softness, feather } = entry.settings;
    return `#${index} wand ${entry.picture} ${entry.clickName} T${tolerance} ${strong ? "strong" : "plain"} s${softness} f${feather}`;
  }
  const settings = Object.entries(entry.tool)
    .filter(([key]) => key !== "mode")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `#${index} ${entry.tool.mode} ${settings} ${entry.points.length} points${entry.afterWand ? " after wand" : ""}`;
}

describe("recorded pixel cases", () => {
  it("decodes the recorded pictures", () => {
    for (const picture of Object.values(pictures)) expect(sha256(decode(picture))).toBe(picture.sha256);
  });

  it.each(cases.map((entry, index) => [caseName(entry, index), entry] as const))("%s", (_name, entry) => {
    const source = decode(pictures[entry.picture]);
    if (entry.kind === "wand") {
      const result = removeWandArea(source, entry.click[0], entry.click[1], entry.settings);
      expect(result.removed).toBe(entry.removed);
      expect([...result.target]).toEqual(entry.target);
      expect(sha256(result.picture)).toBe(entry.outputSha256);
      return;
    }

    let current = copyPicture(source);
    if (entry.afterWand) {
      current = removeWandArea(
        source,
        entry.afterWand.click[0],
        entry.afterWand.click[1],
        entry.afterWand.settings,
      ).picture;
    }
    const settings = strokeSettings(entry, current);
    const canvas = { current, original: source };
    let count = stampBrush(canvas, entry.points[0], settings);
    for (let index = 1; index < entry.points.length; index += 1) {
      count += strokeBrushLine(canvas, entry.points[index - 1], entry.points[index], settings);
    }
    expect(count).toBe(entry.count);
    expect(sha256(current)).toBe(entry.outputSha256);
  });

  it.each(randomWandCases.map((entry) => [`random trial ${entry.trial}`, entry] as const))("%s", (_name, entry) => {
    const source = decode(entry.picture);
    expect(sha256(source)).toBe(entry.picture.sha256);
    const result = removeWandArea(source, entry.click[0], entry.click[1], entry.settings);
    expect(result.removed).toBe(entry.removed);
    expect([...result.target]).toEqual(entry.target);
    expect(sha256(result.picture)).toBe(entry.outputSha256);
  });
});
