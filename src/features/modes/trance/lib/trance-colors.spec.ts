import { describe, expect, it } from "vitest";
import { trancePalette } from "../components/TranceBackdrop";
import { contrastRatio, hexColorsIn, tranceCharacterColors } from "./trance-colors";

const JESTER = {
  nameColor: "linear-gradient(90deg, #6E2DD8, #C9A24A, #B58CFF)",
  dialogueColor: "#B58CFF",
  boxColor: "#37185f",
};
const TICKET_TAKER = {
  nameColor: "linear-gradient(90deg, #0D2F66, #D6AA3D, #E8F2FF)",
  dialogueColor: "#D6AA3D",
  boxColor: "#0c2d5a",
};

const brightness = (hex: string) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);

describe("tranceCharacterColors", () => {
  it("keeps the session's own colours for a card without any", () => {
    expect(tranceCharacterColors({})).toBeNull();
    expect(tranceCharacterColors(undefined)).toBeNull();
    expect(tranceCharacterColors({ nameColor: "rebeccapurple" })).toBeNull();
  });

  it("builds the shades from the card's colours, darker going down and brighter waking", () => {
    const colors = tranceCharacterColors(JESTER)!;
    expect(colors.name).toMatch(/^linear-gradient\(90deg, #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    expect(colors.palettes.down.a).not.toBe(trancePalette({ kind: "down" }).a);
    expect(brightness(colors.palettes.deep.bg)).toBeLessThan(brightness(colors.palettes.down.bg));
    expect(brightness(colors.palettes.sleep.bg)).toBeLessThan(brightness(colors.palettes.deep.bg));
    expect(brightness(colors.palettes.awake.bg)).toBeGreaterThan(brightness(colors.palettes.deep.bg));
  });

  it("keeps the words readable on every shade, ways out included", () => {
    for (const card of [JESTER, TICKET_TAKER, { dialogueColor: "#1a1a40" }, { boxColor: "#f4f0e0" }]) {
      const colors = tranceCharacterColors(card)!;
      const shades = [
        trancePalette({ kind: "down" }, colors.palettes),
        trancePalette({ kind: "deep" }, colors.palettes),
        trancePalette({ kind: "wake", progress: 1 }, colors.palettes),
        trancePalette({ kind: "exit" }, colors.palettes),
      ];
      for (const shade of shades) {
        expect(contrastRatio(colors.words, shade.bg)).toBeGreaterThanOrEqual(4.5);
        // The name above the words too, every colour of its gradient (Ticket Taker's starts in dark navy).
        for (const stop of hexColorsIn(colors.name)) expect(contrastRatio(stop, shade.bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses the dialogue colour for the words when it already reads well", () => {
    expect(tranceCharacterColors(TICKET_TAKER)!.words).toBe("#d6aa3d");
  });

  it("leaves the ways out in their calm colours", () => {
    const colors = tranceCharacterColors(JESTER)!;
    expect(trancePalette({ kind: "exit" }, colors.palettes)).toEqual(trancePalette({ kind: "exit" }));
  });

  it("reads short and long hex colours from colours and gradients", () => {
    expect(hexColorsIn("linear-gradient(90deg, #F0A, #00ff88)")).toEqual(["#ff00aa", "#00ff88"]);
    expect(hexColorsIn(42)).toEqual([]);
  });
});
