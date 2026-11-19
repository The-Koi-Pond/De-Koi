// ──────────────────────────────────────────────
// Weather effects: size the canvas backing store to its box
// ──────────────────────────────────────────────

const MAX_SIDE_CSS_PX = 4096;
const MAX_BACKING_PIXELS = 16_777_216;

function sideInDevicePixels(cssSize: number, viewportSize: number, dpr: number): number {
  let side = Number.isFinite(cssSize) ? cssSize : 0;
  if (Number.isFinite(viewportSize) && viewportSize > 0) side = Math.min(side, viewportSize);
  side = Math.max(Math.min(side, MAX_SIDE_CSS_PX), 1);
  return Math.ceil(side * dpr);
}

/**
 * Match the canvas's backing store to its on-screen size (capped by the viewport, 4096 CSS px a side
 * and 16M pixels in all) and scale the context so drawing happens in CSS pixels.
 * Returns the device pixel ratio used.
 */
export function fitCanvasToBox(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): number {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  let width = sideInDevicePixels(rect.width, window.innerWidth, dpr);
  let height = sideInDevicePixels(rect.height, window.innerHeight, dpr);

  const area = width * height;
  if (area > MAX_BACKING_PIXELS) {
    const scale = Math.sqrt(MAX_BACKING_PIXELS / area);
    width = Math.max(Math.floor(width * scale), 1);
    height = Math.max(Math.floor(height * scale), 1);
  }

  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}
