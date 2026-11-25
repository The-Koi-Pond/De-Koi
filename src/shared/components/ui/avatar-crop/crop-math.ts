import type { AvatarCrop } from "../../../lib/utils";

/** The stage is 360 x 360 px; pictures are fitted inside it and never enlarged. */
export const STAGE_SIZE = 360;
/** The smallest side a crop square can be given from a saved crop or a corner drag. */
export const MIN_SQUARE = 24;

/** The picture's display size in px, unrounded. */
export interface DisplaySize {
  w: number;
  h: number;
}

/** The crop square in display px: top-left corner and side. */
export interface Square {
  x: number;
  y: number;
  size: number;
}

export type Corner = "tl" | "tr" | "bl" | "br";
export type SquarePart = "box" | Corner;

/** `max(lo, min(hi, v))`: a NaN anywhere gives NaN, and `lo` wins when `lo > hi`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Fits the natural size inside the stage; a natural side of 0 counts as 1. */
export function displaySizeOf(naturalWidth: number, naturalHeight: number): DisplaySize {
  const nw = naturalWidth || 1;
  const nh = naturalHeight || 1;
  const scale = Math.min(STAGE_SIZE / nw, STAGE_SIZE / nh, 1);
  return { w: nw * scale, h: nh * scale };
}

/** The largest centered square. */
export function defaultSquare({ w, h }: DisplaySize): Square {
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

/**
 * The square a saved crop gives while getting ready, before any clamping. Only `srcX`, `srcY` and `srcWidth` are
 * read, with `*` (text numbers count, missing fields give NaN). `crop` must not be legacy; null gives the default.
 */
export function unclampedSquareFromCrop(crop: AvatarCrop | null, display: DisplaySize): Square {
  if (!crop) return defaultSquare(display);
  return { x: crop.srcX * display.w, y: crop.srcY * display.h, size: crop.srcWidth * display.w };
}

/** The square a saved crop shows once followed: the same reads, clamped to the picture. Null gives the default. */
export function squareFromCrop(crop: AvatarCrop | null, display: DisplaySize): Square {
  if (!crop) return defaultSquare(display);
  const { w, h } = display;
  const size = clamp(crop.srcWidth * w, MIN_SQUARE, Math.min(w, h));
  return { x: clamp(crop.srcX * w, 0, w - size), y: clamp(crop.srcY * h, 0, h - size), size };
}

/** The crop handed to the caller: exactly these divisions, in this key order. */
export function cropFromSquare({ x, y, size }: Square, { w, h }: DisplaySize): AvatarCrop {
  return { srcX: x / w, srcY: y / h, srcWidth: size / w, srcHeight: size / h };
}

/** The square after dragging `part` by (dx, dy) from the start square. Corners keep the opposite corner still. */
export function dragSquare(part: SquarePart, start: Square, dx: number, dy: number, { w, h }: DisplaySize): Square {
  const L = start.x;
  const T = start.y;
  const R = L + start.size;
  const B = T + start.size;
  switch (part) {
    case "box":
      return { x: clamp(L + dx, 0, w - start.size), y: clamp(T + dy, 0, h - start.size), size: start.size };
    case "br": {
      const size = clamp(Math.min(R + dx - L, B + dy - T), MIN_SQUARE, Math.min(w - L, h - T));
      return { x: L, y: T, size };
    }
    case "tl": {
      const size = clamp(Math.min(R - (L + dx), B - (T + dy)), MIN_SQUARE, Math.min(R, B));
      return { x: R - size, y: B - size, size };
    }
    case "tr": {
      const size = clamp(Math.min(R + dx - L, B - (T + dy)), MIN_SQUARE, Math.min(w - L, B));
      return { x: L, y: B - size, size };
    }
    case "bl": {
      const size = clamp(Math.min(R - (L + dx), B + dy - T), MIN_SQUARE, Math.min(R, h - T));
      return { x: R - size, y: T, size };
    }
  }
}
