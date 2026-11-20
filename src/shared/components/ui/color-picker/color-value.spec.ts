import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOPS,
  GRADIENT_PRESETS,
  SOLID_PRESETS,
  buildGradient,
  isGradient,
  isSixDigitHex,
  readGradientAngle,
  readGradientStops,
} from "./color-value";

describe("isGradient", () => {
  it("is true only for values starting with linear-gradient", () => {
    expect(isGradient("linear-gradient(90deg, #fff, #000)")).toBe(true);
    expect(isGradient("linear-gradient")).toBe(true);
    for (const value of [
      "",
      "red",
      "#ff6b6b",
      "rgba(255, 0, 0, 0.5)",
      "radial-gradient(circle, #f00, #00f)",
      " linear-gradient(90deg, #fff, #000)",
      "repeating-linear-gradient(90deg, #fff, #000)",
    ])
      expect(isGradient(value), value).toBe(false);
  });
});

describe("readGradientStops", () => {
  it("reads the trimmed stops after the angle part", () => {
    expect(readGradientStops("linear-gradient(45deg, #111111, #222222, #333333)")).toEqual([
      "#111111",
      "#222222",
      "#333333",
    ]);
    expect(readGradientStops("linear-gradient(to right, #aa0000,#00aa00 )")).toEqual(["#aa0000", "#00aa00"]);
  });

  it("splits a stop with commas inside it (decision 4)", () => {
    expect(readGradientStops("linear-gradient(90deg, rgb(1, 2, 3), #ffffff)")).toEqual(["rgb(1", "2", "3)", "#ffffff"]);
  });

  it("drops the first color of a gradient with no angle part (decision 4)", () => {
    expect(readGradientStops("linear-gradient(#ffffff, #000000)")).toEqual(["#000000"]);
  });

  it("keeps empty stops as empty text", () => {
    expect(readGradientStops("linear-gradient(90deg, , #ffd93d)")).toEqual(["", "#ffd93d"]);
  });

  it("gives the default stops for gradient values that don't fit", () => {
    for (const value of [
      "linear-gradient",
      "linear-gradient(red)",
      "linear-gradient(90deg, #fff",
      "linear-gradient 90deg, #fff)",
    ])
      expect(readGradientStops(value), value).toEqual([...DEFAULT_STOPS]);
    expect(DEFAULT_STOPS).toEqual(["#ff6b6b", "#ffd93d"]);
  });

  it("returns a fresh array each time", () => {
    const stops = readGradientStops("linear-gradient");
    stops.push("#000000");
    expect(readGradientStops("linear-gradient")).toEqual(["#ff6b6b", "#ffd93d"]);
  });
});

describe("readGradientAngle", () => {
  it("reads a whole number of degrees right after linear-gradient(", () => {
    expect(readGradientAngle("linear-gradient(45deg, #fff, #000)")).toBe(45);
    expect(readGradientAngle("linear-gradient(0deg, #fff, #000)")).toBe(0);
    expect(readGradientAngle("linear-gradient(360deg, #fff, #000)")).toBe(360);
    expect(readGradientAngle("linear-gradient(720deg, #fff, #000)")).toBe(720);
  });

  it("reads no angle for fractions, negatives, keywords, other units or a missing angle", () => {
    for (const value of [
      "linear-gradient(45.5deg, #123456, #654321)",
      "linear-gradient(-30deg, #123456, #654321)",
      "linear-gradient(to right, #aa0000, #00aa00)",
      "linear-gradient(0.25turn, #fff, #000)",
      "linear-gradient( 45deg, #fff, #000)",
      "linear-gradient(#ffffff, #000000)",
      "red",
    ])
      expect(readGradientAngle(value), value).toBeNull();
  });
});

describe("buildGradient", () => {
  it("writes the exact stored format", () => {
    expect(buildGradient(["#ff6b6b", "#ffd93d"], 90)).toBe("linear-gradient(90deg, #ff6b6b, #ffd93d)");
    expect(buildGradient(["rgb(1", "2", "3)", "#ffffff"], 0)).toBe("linear-gradient(0deg, rgb(1, 2, 3), #ffffff)");
    expect(buildGradient(["", "#ffd93d"], 360)).toBe("linear-gradient(360deg, , #ffd93d)");
    expect(buildGradient(["#000000"], 37)).toBe("linear-gradient(37deg, #000000)");
  });

  it("round-trips every gradient preset", () => {
    for (const preset of GRADIENT_PRESETS)
      expect(buildGradient(readGradientStops(preset), readGradientAngle(preset)!)).toBe(preset);
  });
});

describe("presets", () => {
  it("lists the 20 solid and 12 gradient presets in the spec's order", () => {
    expect(SOLID_PRESETS).toHaveLength(20);
    expect(SOLID_PRESETS[0]).toBe("#ff6b6b");
    expect(SOLID_PRESETS[19]).toBe("#d63031");
    expect(GRADIENT_PRESETS).toHaveLength(12);
    expect(GRADIENT_PRESETS[8]).toBe("linear-gradient(135deg, #667eea, #764ba2)");
    expect(GRADIENT_PRESETS[11]).toBe("linear-gradient(135deg, #43e97b, #38f9d7)");
  });
});

describe("isSixDigitHex", () => {
  it("accepts only # and six hex digits, in either case", () => {
    expect(isSixDigitHex("#abcdef")).toBe(true);
    expect(isSixDigitHex("#ABCDEF")).toBe(true);
    for (const value of ["#fff", "#abcdefa", "abcdef", "red", "#ggggggg", "#ff6b6b "])
      expect(isSixDigitHex(value), value).toBe(false);
  });
});
