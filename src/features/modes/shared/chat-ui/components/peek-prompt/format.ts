/** Rough token estimate the viewer shows: a quarter of the JavaScript string length, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function plural(count: number, word: string): string {
  return `${word}${count === 1 ? "" : "s"}`;
}

/** `system_prompt` -> `System Prompt`. */
export function blockLabel(label: string): string {
  return label.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const AMBER = "bg-amber-500/20 text-amber-400";
const BLUE = "bg-blue-500/20 text-blue-400";
const PURPLE = "bg-purple-500/20 text-purple-400";
export const HISTORY_BADGE_TONE = "bg-green-500/20 text-green-400";

export function sectionBadgeTone(label: string, role: string): string {
  if (/last.?message/i.test(label)) return BLUE;
  if (role === "system") return AMBER;
  if (role === "user") return BLUE;
  return PURPLE;
}

export function entryBadgeTone(role: string): string {
  if (role === "user") return BLUE;
  if (role === "assistant") return PURPLE;
  return AMBER;
}
