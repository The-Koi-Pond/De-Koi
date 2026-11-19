/** Zoom limits and steps for the cleanup stage, and the pointer → picture pixel rule. */
export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 8;
const BUTTON_STEP = 1.25;
const WHEEL_STEP = 1.15;
/** The fitted picture keeps this many px free across the stage's inner width and height. */
const FIT_MARGIN = 32;
/** From this zoom on, the picture is shown with sharp pixels. */
export const SHARP_PIXELS_ZOOM = 2;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomIn(zoom: number): number {
  return clampZoom(zoom * BUTTON_STEP);
}

export function zoomOut(zoom: number): number {
  return clampZoom(zoom / BUTTON_STEP);
}

/** Ctrl/Cmd + wheel: up zooms in, down (or no vertical move) zooms out. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(deltaY < 0 ? zoom * WHEEL_STEP : zoom / WHEEL_STEP);
}

/** The largest zoom that fits the picture in the stage less the margin, never above 100%. */
export function fitZoom(stage: { width: number; height: number }, picture: { width: number; height: number }): number {
  const width = Math.max(1, stage.width - FIT_MARGIN);
  const height = Math.max(1, stage.height - FIT_MARGIN);
  return clampZoom(Math.min(1, width / picture.width, height / picture.height));
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * The picture pixel under a pointer: its fraction across the shown canvas times the picture's size, rounded down and
 * kept inside the picture. Null outside the shown canvas.
 */
export function pixelUnderPointer(
  pointer: { x: number; y: number },
  shown: { left: number; top: number; width: number; height: number },
  picture: { width: number; height: number },
): { x: number; y: number } | null {
  if (shown.width <= 0 || shown.height <= 0) return null;
  const fractionX = (pointer.x - shown.left) / shown.width;
  const fractionY = (pointer.y - shown.top) / shown.height;
  if (fractionX < 0 || fractionX > 1 || fractionY < 0 || fractionY > 1) return null;
  return {
    x: Math.min(picture.width - 1, Math.max(0, Math.floor(fractionX * picture.width))),
    y: Math.min(picture.height - 1, Math.max(0, Math.floor(fractionY * picture.height))),
  };
}
