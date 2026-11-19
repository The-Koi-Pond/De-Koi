import { blockWeight, clamp01, copyPicture, distanceToColor, type Rgb, type Rgba, type RgbaPicture } from "./picture";

/** What a stroke does, in the old rules' names: Color mode paints, Clean is "clean". */
export type BrushMode = "erase" | "paint" | "restore" | "clean" | "blur";

/** One stroke's settings, fixed when it starts. Sliders are 0–100 numbers. */
export type BrushSettings =
  | { mode: "erase"; radius: number; hardness: number; opacity: number }
  | { mode: "paint"; radius: number; hardness: number; opacity: number; color: Rgb }
  | { mode: "restore"; radius: number; hardness: number; opacity: number }
  | { mode: "clean"; radius: number; target: Rgba; tolerance: number; edgeGuard: number; feather: number }
  | { mode: "blur"; radius: number; strength: number };

export interface Point {
  x: number;
  y: number;
}

/** The brush radius for a Brush size: half of it, at least 1. */
export function brushRadius(size: number): number {
  return Math.max(1, size / 2);
}

/**
 * Where one stroke draws. `current` is changed in place; `original` is the picture as the editor opened it (Restore);
 * `changed`, when given, marks every pixel any stamp changed.
 */
export interface StrokeCanvas {
  current: RgbaPicture;
  original: RgbaPicture;
  changed?: Uint8Array;
}

const SEE_THROUGH_ALPHA = 8;

/** The press: one stamp on the pressed point. Returns how many pixels the stamp changed. */
export function stampBrush(canvas: StrokeCanvas, point: Point, settings: BrushSettings): number {
  const reference = needsSnapshot(settings) ? copyPicture(canvas.current) : canvas.current;
  return stamp(canvas, reference, point.x, point.y, settings);
}

/**
 * A move: stamps along the straight line from `from` to `to`, at fractions 1/n … 1 of the way (not on `from` again).
 * Returns the sum of the stamps' changed-pixel counts.
 */
export function strokeBrushLine(canvas: StrokeCanvas, from: Point, to: Point, settings: BrushSettings): number {
  const reference = needsSnapshot(settings) ? copyPicture(canvas.current) : canvas.current;
  const distance = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  const stamps = Math.max(1, Math.ceil(distance / Math.max(1, 0.45 * settings.radius)));
  let changed = 0;
  for (let step = 1; step <= stamps; step += 1) {
    const share = step / stamps;
    changed += stamp(canvas, reference, from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share, settings);
  }
  return changed;
}

/** Clean and Blur test pixels against a snapshot taken before the press or the move. */
function needsSnapshot(settings: BrushSettings): boolean {
  return settings.mode === "clean" || settings.mode === "blur";
}

function hardnessFalloff(share: number, hardness: number): number {
  const h = hardness / 100;
  const core = h >= 0.99 ? 1 : h ** 1.35;
  if (share <= core) return 1;
  return clamp01((1 - share) / Math.max(0.001, 1 - core)) ** (1 + 1.8 * (1 - h));
}

function stamp(canvas: StrokeCanvas, reference: RgbaPicture, cx: number, cy: number, settings: BrushSettings): number {
  const { current } = canvas;
  const { width, height } = current;
  const radius = settings.radius;
  const pixelChange = pixelRule(canvas, reference, settings);
  if (!pixelChange) return 0;

  const minX = Math.max(0, Math.ceil(cx - radius));
  const maxX = Math.min(width - 1, Math.floor(cx + radius));
  const minY = Math.max(0, Math.ceil(cy - radius));
  const maxY = Math.min(height - 1, Math.floor(cy + radius));
  const radiusSquared = radius * radius;
  let changed = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2;
      if (distanceSquared > radiusSquared) continue;
      const index = y * width + x;
      if (pixelChange(index, x, y, Math.sqrt(distanceSquared) / radius)) {
        changed += 1;
        if (canvas.changed) canvas.changed[index] = 1;
      }
    }
  }
  return changed;
}

/** One covered pixel's change: returns whether it changed. */
type PixelChange = (index: number, x: number, y: number, share: number) => boolean;

function pixelRule(canvas: StrokeCanvas, reference: RgbaPicture, settings: BrushSettings): PixelChange | null {
  const data = canvas.current.data;
  switch (settings.mode) {
    case "erase": {
      const opacity = settings.opacity / 100;
      return (index, _x, _y, share) => {
        const offset = index * 4 + 3;
        const alpha = data[offset];
        if (alpha === 0) return false;
        const next = Math.round(alpha * (1 - hardnessFalloff(share, settings.hardness) * opacity));
        data[offset] = next;
        return next !== alpha;
      };
    }
    case "paint": {
      const opacity = settings.opacity / 100;
      return (index, _x, _y, share) => {
        const strength = hardnessFalloff(share, settings.hardness) * opacity;
        if (strength <= 0.001) return false;
        const offset = index * 4;
        const kept = (data[offset + 3] / 255) * (1 - strength);
        const total = strength + kept;
        const next: Rgba =
          total === 0
            ? [0, 0, 0, 0]
            : [
                Math.round((settings.color[0] * strength + data[offset] * kept) / total),
                Math.round((settings.color[1] * strength + data[offset + 1] * kept) / total),
                Math.round((settings.color[2] * strength + data[offset + 2] * kept) / total),
                Math.round(total * 255),
              ];
        return writePixel(data, offset, next);
      };
    }
    case "restore": {
      const opacity = settings.opacity / 100;
      const original = canvas.original.data;
      return (index, _x, _y, share) => {
        const amount = hardnessFalloff(share, settings.hardness) * opacity;
        if (amount <= 0) return false;
        const offset = index * 4;
        if (amount >= 0.999) {
          return writePixel(data, offset, [
            original[offset],
            original[offset + 1],
            original[offset + 2],
            original[offset + 3],
          ]);
        }
        const ownWeight = (data[offset + 3] / 255) * (1 - amount);
        const originalWeight = (original[offset + 3] / 255) * amount;
        const total = ownWeight + originalWeight;
        const next: Rgba =
          total === 0
            ? [0, 0, 0, 0]
            : [
                Math.round((data[offset] * ownWeight + original[offset] * originalWeight) / total),
                Math.round((data[offset + 1] * ownWeight + original[offset + 1] * originalWeight) / total),
                Math.round((data[offset + 2] * ownWeight + original[offset + 2] * originalWeight) / total),
                Math.round(total * 255),
              ];
        return writePixel(data, offset, next);
      };
    }
    case "clean":
      return cleanRule(data, reference, settings);
    case "blur":
      return blurRule(data, reference, settings.strength / 100);
  }
}

function writePixel(data: Uint8ClampedArray, offset: number, next: Rgba): boolean {
  const changed =
    data[offset] !== next[0] ||
    data[offset + 1] !== next[1] ||
    data[offset + 2] !== next[2] ||
    data[offset + 3] !== next[3];
  data[offset] = next[0];
  data[offset + 1] = next[1];
  data[offset + 2] = next[2];
  data[offset + 3] = next[3];
  return changed;
}

function cleanRule(
  data: Uint8ClampedArray,
  reference: RgbaPicture,
  settings: Extract<BrushSettings, { mode: "clean" }>,
): PixelChange | null {
  const { target } = settings;
  if (target[3] <= SEE_THROUGH_ALPHA) return null;
  const tolerance = Math.max(1, settings.tolerance);
  const guard = settings.edgeGuard / 100;
  const feather = settings.feather / 100;
  const characterLike = tolerance * (1.04 - 0.18 * guard);
  const weakMatch = tolerance * (0.22 + 0.44 * (1 - guard));
  const crowdedShare = 0.22 + 0.45 * (1 - guard);
  const core = feather <= 0.01 ? 1 : 1 - 0.84 * feather;
  const { width, height } = reference;
  const snapshot = reference.data;

  return (index, x, y, share) => {
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha === 0) return false;
    const distance = distanceToColor(snapshot, offset, target);
    if (distance > tolerance) return false;
    if (guard > 0) {
      let neighbours = 0;
      let characterNeighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = (ny * width + nx) * 4;
          if (snapshot[neighbour + 3] <= 32) continue;
          neighbours += 1;
          if (distanceToColor(snapshot, neighbour, target) > characterLike) characterNeighbours += 1;
        }
      }
      if (distance > weakMatch && neighbours > 0 && characterNeighbours / neighbours > crowdedShare) return false;
    }
    const eraseShare = share <= core ? 1 : clamp01((1 - share) / Math.max(0.001, 1 - core)) ** 1.65;
    const next = Math.round(alpha * (1 - eraseShare));
    data[offset + 3] = next;
    return next !== alpha;
  };
}

function blurRule(data: Uint8ClampedArray, reference: RgbaPicture, strength: number): PixelChange | null {
  if (strength <= 0) return null;
  const { width, height } = reference;
  const snapshot = reference.data;
  return (index, x, y) => {
    const before = snapshot[index * 4 + 3];
    if (before <= SEE_THROUGH_ALPHA) return false;
    let lowest = 255;
    let highest = 0;
    let total = 0;
    let weighted = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const alpha = snapshot[(ny * width + nx) * 4 + 3];
        const weight = blockWeight(dx, dy, 1.75);
        lowest = Math.min(lowest, alpha);
        highest = Math.max(highest, alpha);
        total += weight;
        weighted += weight * alpha;
      }
    }
    if (highest - lowest < 24) return false;
    const average = Math.round(weighted / total);
    const next = Math.min(before, Math.round(before * (1 - strength) + average * strength));
    data[index * 4 + 3] = next;
    return next !== before;
  };
}
