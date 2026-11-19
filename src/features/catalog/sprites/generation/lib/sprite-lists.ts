/** What the dialog draws: portrait expressions or full-body poses. Sent as `spriteType`. */
export type SpriteType = "expressions" | "full-body";

export interface SpriteGrid {
  cols: number;
  rows: number;
}

export type SpriteCount = 1 | 6 | 9 | 12 | 16;

/** The count buttons, the same for both types. */
export const SPRITE_COUNTS: ReadonlyArray<{ count: SpriteCount } & SpriteGrid> = [
  { count: 1, cols: 1, rows: 1 },
  { count: 6, cols: 2, rows: 3 },
  { count: 9, cols: 3, rows: 3 },
  { count: 12, cols: 3, rows: 4 },
  { count: 16, cols: 4, rows: 4 },
];

export const DEFAULT_SPRITE_COUNT: SpriteCount = 6;

/** Every expression chip, in the order shown. */
export const ALL_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "thinking",
  "laughing",
  "crying",
  "blushing",
  "smirk",
  "embarrassed",
  "determined",
  "confused",
  "sleepy",
] as const;

/** Every pose chip, in the order shown. */
export const ALL_POSES = [
  "idle",
  "walk",
  "run",
  "battle_stance",
  "attack",
  "defend",
  "casting",
  "hurt",
  "jump",
  "thinking",
  "cheer",
  "victory",
  "wave",
  "sit",
  "kneel",
  "point",
] as const;

const DEFAULT_EXPRESSIONS: Record<SpriteCount, readonly string[]> = {
  1: ["neutral"],
  6: ["neutral", "happy", "sad", "angry", "surprised", "smirk"],
  9: ["neutral", "happy", "sad", "angry", "surprised", "scared", "disgusted", "thinking", "laughing"],
  12: [
    "neutral",
    "happy",
    "sad",
    "angry",
    "surprised",
    "scared",
    "disgusted",
    "thinking",
    "laughing",
    "crying",
    "determined",
    "confused",
  ],
  16: ALL_EXPRESSIONS,
};

const DEFAULT_POSES: Record<SpriteCount, readonly string[]> = {
  1: ["idle"],
  6: ["idle", "walk", "battle_stance", "casting", "defend", "victory"],
  9: ["idle", "walk", "run", "battle_stance", "attack", "defend", "casting", "hurt", "victory"],
  12: [
    "idle",
    "walk",
    "run",
    "battle_stance",
    "attack",
    "defend",
    "casting",
    "hurt",
    "jump",
    "thinking",
    "cheer",
    "victory",
  ],
  16: ALL_POSES,
};

export function gridForCount(count: SpriteCount): SpriteGrid {
  const option = SPRITE_COUNTS.find((item) => item.count === count) ?? SPRITE_COUNTS[1];
  return { cols: option.cols, rows: option.rows };
}

/** The count button's label, e.g. `6 (2×3)`: the count, then columns × rows. */
export function countLabel(count: SpriteCount): string {
  const { cols, rows } = gridForCount(count);
  return `${count} (${cols}×${rows})`;
}

export function defaultPicks(type: SpriteType, count: SpriteCount): string[] {
  return [...(type === "full-body" ? DEFAULT_POSES : DEFAULT_EXPRESSIONS)[count]];
}

export function chipNames(type: SpriteType): readonly string[] {
  return type === "full-body" ? ALL_POSES : ALL_EXPRESSIONS;
}

/** A name as people read it: `_` as a space. */
export function spacedName(name: string): string {
  return name.replace(/_/g, " ");
}

/** A chip's text: `_` as a space and a capital first letter. */
export function chipLabel(name: string): string {
  const spaced = spacedName(name);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Clicking a chip. A picked chip is removed. With one cell, an unpicked chip becomes the only pick; otherwise it is
 * added at the end, and when the picks already fill the grid the oldest is dropped first.
 */
export function togglePick(picks: readonly string[], name: string, capacity: number): string[] {
  if (picks.includes(name)) return picks.filter((pick) => pick !== name);
  if (capacity <= 1) return [name];
  const kept = picks.length >= capacity ? picks.slice(picks.length - capacity + 1) : [...picks];
  return [...kept, name];
}
