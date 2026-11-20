// Reading and writing the color strings the picker hands to its callers. Callers store these strings as
// they are, so the formats here are a compatibility contract (docs/provenance/color-picker.md).

export const DEFAULT_STOPS: readonly string[] = ["#ff6b6b", "#ffd93d"];
export const DEFAULT_ANGLE = 90;
/** Added by "Add" at the end of the stops. */
export const NEW_STOP = "#ffffff";
/** What the solid "Pick color" row shows when the value has no solid color to show. */
export const FALLBACK_PICK_COLOR = "#6c5ce7";

export const SOLID_PRESETS: readonly string[] = [
  "#ff6b6b",
  "#ee5a24",
  "#f0932b",
  "#ffd93d",
  "#6ab04c",
  "#22a6b3",
  "#4834d4",
  "#6c5ce7",
  "#e056fd",
  "#fd79a8",
  "#fdcb6e",
  "#00cec9",
  "#2ed573",
  "#1e90ff",
  "#a29bfe",
  "#ff7979",
  "#badc58",
  "#7ed6df",
  "#e17055",
  "#d63031",
];

export const GRADIENT_PRESETS: readonly string[] = [
  "linear-gradient(90deg, #ff6b6b, #ffd93d)",
  "linear-gradient(90deg, #a29bfe, #fd79a8)",
  "linear-gradient(90deg, #6c5ce7, #00cec9)",
  "linear-gradient(90deg, #e056fd, #4834d4)",
  "linear-gradient(90deg, #f0932b, #ee5a24)",
  "linear-gradient(90deg, #22a6b3, #6ab04c)",
  "linear-gradient(90deg, #1e90ff, #a29bfe)",
  "linear-gradient(90deg, #ff7979, #e056fd)",
  "linear-gradient(135deg, #667eea, #764ba2)",
  "linear-gradient(135deg, #f093fb, #f5576c)",
  "linear-gradient(135deg, #4facfe, #00f2fe)",
  "linear-gradient(135deg, #43e97b, #38f9d7)",
];

export function isGradient(value: string): boolean {
  return value.startsWith("linear-gradient");
}

/**
 * The stops of a gradient value: the text after the first comma inside `linear-gradient(` up to the
 * last `)`, split at every comma. Commas inside a stop (`rgb(1, 2, 3)`) and a missing angle part are not
 * understood on purpose (decision 4): the first would split the stop, the second drops the first color.
 */
export function readGradientStops(value: string): string[] {
  const match = /^linear-gradient\([^,]*,([\s\S]*)\)/.exec(value);
  if (!match) return [...DEFAULT_STOPS];
  return match[1]!.split(",").map((stop) => stop.trim());
}

/** The whole, non-negative number of degrees right after `linear-gradient(`, or null when there is none. */
export function readGradientAngle(value: string): number | null {
  const match = /^linear-gradient\((\d+)deg/.exec(value);
  return match ? Number(match[1]) : null;
}

export function buildGradient(stops: readonly string[], angle: number): string {
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

/** Whether a native `<input type="color">` can show this value as it is. */
export function isSixDigitHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
