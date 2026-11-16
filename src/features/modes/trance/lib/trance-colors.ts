// A trance session in its guide's colours: the words in the character's dialogue colour and the moving
// background built from their name and box colours, so the session reads as them talking even with no voice.

export type TrancePalette = { bg: string; a: string; b: string; c: string };

/** The session's own colours, used when the guide has none. The ways out always use `exit`. */
export const TRANCE_PALETTES: Record<"down" | "deep" | "sleep" | "exit" | "awake", TrancePalette> = {
  down: { bg: "#0d0b1a", a: "#6d4bd8", b: "#2a7f8f", c: "#8a3f7a" },
  deep: { bg: "#07061a", a: "#4a33a8", b: "#1d5866", c: "#5e2b56" },
  sleep: { bg: "#030308", a: "#2b2160", b: "#10303a", c: "#2e1530" },
  exit: { bg: "#0e1320", a: "#4f6f9f", b: "#3a7a7a", c: "#6a6a9a" },
  awake: { bg: "#1c2236", a: "#9d8cff", b: "#5fc4c4", c: "#d48ab8" },
};

/** The shades that follow the guide's colours. The ways out keep their own calm colours. */
export type TranceCharacterShade = "down" | "deep" | "sleep" | "awake";

export interface TranceCharacterColors {
  /**
   * The card's name colour or gradient (CSS), each colour lightened as needed to read on the session, for the small
   * name above the words; null when the card has no name colour.
   */
  name: string | null;
  /** The colour of the words, lightened when needed so it stays readable on every shade. */
  words: string;
  palettes: Record<TranceCharacterShade, TrancePalette>;
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const BLACK = "#000000";
const WHITE = "#ffffff";
/** WCAG AA for body text. */
const MIN_CONTRAST = 4.5;

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Mixes two #rrggbb colours; `t` 0 is `from`, 1 is `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const amount = Math.max(0, Math.min(1, t));
  const parts = [0, 1, 2].map((index) =>
    Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

/** #rgb and #rrggbb colours in a CSS value (a colour or a gradient), as #rrggbb. */
export function hexColorsIn(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return (value.match(HEX) ?? []).map((hex) => {
    const lower = hex.toLowerCase();
    return lower.length === 4 ? `#${[...lower.slice(1)].map((digit) => digit + digit).join("")}` : lower;
  });
}

function luminance(hex: string): number {
  const linear = [0, 1, 2].map((index) => {
    const value = channel(hex, index) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The colour, lightened just enough to read on `background`. */
function readableOn(color: string, background: string): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(color, WHITE, step / 10);
    if (contrastRatio(candidate, background) >= MIN_CONTRAST) return candidate;
  }
  return WHITE;
}

/** The colour, darkened until it suits a dark session screen (light box colours would wash the words out). */
function darkEnough(color: string): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(color, BLACK, step / 10);
    if (luminance(candidate) <= 0.06) return candidate;
  }
  return BLACK;
}

const darker = (palette: TrancePalette, bg: number, accents: number): TrancePalette => ({
  bg: mixHex(palette.bg, BLACK, bg),
  a: mixHex(palette.a, BLACK, accents),
  b: mixHex(palette.b, BLACK, accents),
  c: mixHex(palette.c, BLACK, accents),
});

/**
 * The session colours for a character's `extensions` (nameColor, dialogueColor, boxColor). Null when the card has
 * none of them, so the session keeps its own colours.
 */
export function tranceCharacterColors(extensions: unknown): TranceCharacterColors | null {
  const record = extensions && typeof extensions === "object" ? (extensions as Record<string, unknown>) : {};
  const stops = hexColorsIn(record.nameColor);
  const dialogue = hexColorsIn(record.dialogueColor)[0] ?? null;
  const box = hexColorsIn(record.boxColor)[0] ?? null;
  const first = stops[0] ?? dialogue ?? box;
  if (!first) return null;
  const base: TrancePalette = {
    bg: darkEnough(box ?? mixHex(first, BLACK, 0.6)),
    a: first,
    b: stops[1] ?? dialogue ?? first,
    c: stops[2] ?? dialogue ?? stops[1] ?? first,
  };
  const palettes: Record<TranceCharacterShade, TrancePalette> = {
    down: darker(base, 0.55, 0.15),
    deep: darker(base, 0.75, 0.4),
    sleep: darker(base, 0.9, 0.7),
    awake: {
      bg: mixHex(base.bg, BLACK, 0.3),
      a: mixHex(base.a, WHITE, 0.15),
      b: mixHex(base.b, WHITE, 0.15),
      c: mixHex(base.c, WHITE, 0.15),
    },
  };
  // Readable on the lightest background the words can sit on (the guide's shades and the calm way-out one)
  // means readable on all of them.
  const lightest = [...Object.values(palettes).map((palette) => palette.bg), TRANCE_PALETTES.exit.bg].sort(
    (left, right) => luminance(right) - luminance(left),
  )[0]!;
  const words = readableOn(dialogue ?? base.c, lightest);
  const nameStops = stops.map((stop) => readableOn(stop, lightest));
  const name = nameStops.length > 1 ? `linear-gradient(90deg, ${nameStops.join(", ")})` : (nameStops[0] ?? null);
  return { name, words, palettes };
}
