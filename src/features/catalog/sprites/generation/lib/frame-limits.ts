import type { SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";

export const MAX_FRAME_EDGE = 80;
export const MAX_FRAME_PAIR = 90;

export type FrameEdge = keyof SpriteFrameAdjustments;

const OPPOSITE: Record<FrameEdge, FrameEdge> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export const ZERO_FRAME: SpriteFrameAdjustments = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Sets one edge of the frame. Each edge stays between 0 and 80 (anything not a number is 0), and an edge plus its
 * opposite may not pass 90: raising one lowers the other by the excess, never below 0.
 */
export function setFrameEdge(frame: SpriteFrameAdjustments, edge: FrameEdge, value: number): SpriteFrameAdjustments {
  const clamped = Number.isFinite(value) ? Math.min(MAX_FRAME_EDGE, Math.max(0, value)) : 0;
  const opposite = OPPOSITE[edge];
  const excess = clamped + frame[opposite] - MAX_FRAME_PAIR;
  return {
    ...frame,
    [edge]: clamped,
    [opposite]: excess > 0 ? Math.max(0, frame[opposite] - excess) : frame[opposite],
  };
}
