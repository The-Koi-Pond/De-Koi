import type { CSSProperties } from "react";

/** Offsets in px, scale and opacity for an element's enter start or exit end. */
export interface MotionPose {
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  /** Blur in px; only used by `motion-enter-blur`. */
  blur?: number;
}

const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
/** A short overshoot, close to a damped spring. */
export const SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * CSS custom properties for the `motion-enter`, `motion-enter-blur` and
 * `motion-exit` classes. `enterFrom` is where an entering element starts and
 * `exitTo` where a leaving one ends; both settle on, or start from, the
 * element's own resting styles. Omitted values fall back to the class
 * defaults: no offset, scale 1, opacity 0, 200ms.
 */
export function motionStyle({
  enterFrom,
  exitTo,
  durationMs,
  exitDurationMs,
  ease = EASE_OUT_EXPO,
  exitEase,
}: {
  enterFrom?: MotionPose;
  exitTo?: MotionPose;
  durationMs?: number;
  exitDurationMs?: number;
  ease?: string;
  exitEase?: string;
}): CSSProperties {
  const vars: Record<string, string> = { "--motion-ease": ease };
  const pose = (prefix: string, value: MotionPose | undefined) => {
    if (!value) return;
    if (value.x !== undefined) vars[`--motion-${prefix}-x`] = `${value.x}px`;
    if (value.y !== undefined) vars[`--motion-${prefix}-y`] = `${value.y}px`;
    if (value.scale !== undefined) vars[`--motion-${prefix}-scale`] = String(value.scale);
    if (value.opacity !== undefined) vars[`--motion-${prefix}-opacity`] = String(value.opacity);
    if (value.blur !== undefined) vars[`--motion-${prefix}-blur`] = `${value.blur}px`;
  };
  pose("from", enterFrom);
  pose("to", exitTo);
  if (durationMs !== undefined) vars["--motion-duration"] = `${durationMs}ms`;
  if (exitDurationMs !== undefined) vars["--motion-exit-duration"] = `${exitDurationMs}ms`;
  if (exitEase) vars["--motion-exit-ease"] = exitEase;
  return vars as CSSProperties;
}
