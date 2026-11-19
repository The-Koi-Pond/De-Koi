// ──────────────────────────────────────────────
// Weather effects: the frame loop that moves and draws one scene on a canvas
// ──────────────────────────────────────────────
import { fitCanvasToBox } from "./canvas-size";
import { drawCelestialBody, drawParticle } from "./drawing";
import { advanceParticle, createParticle, createSceneParticles, isParticleSpent } from "./particles";
import type { WeatherScene } from "./weather-scene";

/** One particle-motion frame, in ms (particle speeds are per 60 FPS frame). */
const MOTION_FRAME_MS = 1000 / 60;
/** Drawing is capped at 30 FPS. */
const MIN_DRAW_INTERVAL_MS = 1000 / 30;
const MAX_MOTION_FRAMES = 4;

/** Clamp to 0..4. */
export function capWeatherParticleMotionFrames(elapsedFrames: number): number {
  return Math.min(Math.max(elapsedFrames, 0), MAX_MOTION_FRAMES);
}

/** Occasional full-screen flashes for thunderstorms, timed on the animation clock. */
class LightningFlashes {
  private nextFlashAt = (200 + 400 * Math.random()) * MOTION_FRAME_MS;
  private strength = 0;

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, clock: number, frames: number): void {
    if (clock >= this.nextFlashAt) {
      this.strength = 0.45 + 0.15 * Math.random();
      this.nextFlashAt = clock + (400 + 800 * Math.random()) * MOTION_FRAME_MS;
    }
    if (this.strength <= 0) return;

    ctx.fillStyle = `rgba(220,230,255,${this.strength})`;
    ctx.fillRect(0, 0, width, height);
    // Decays with the uncapped frame count (spec decision 2).
    this.strength *= 0.88 ** frames;
    if (this.strength < 0.01) this.strength = 0;
  }
}

/**
 * Start drawing `scene` on `canvas`: size it, create the particles and run frames (once for a static
 * scene, continuously for an animated one) until the returned stop function is called.
 */
export function startWeatherLoop(canvas: HTMLCanvasElement, scene: WeatherScene): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let dpr = fitCanvasToBox(canvas, ctx);
  const particles = createSceneParticles(scene, canvas.width / dpr, canvas.height / dpr);
  const lightning = scene.lightning ? new LightningFlashes() : null;
  const drawsBody = scene.showsBody && scene.clearSky;

  let pendingFrame: number | null = null;
  let stopped = false;
  let drawing = false;
  let hiddenPause = false;
  /** Timestamp of the last drawn frame; null before the first one (or after the tab comes back). */
  let lastDrawnAt: number | null = null;
  let clock = 0;

  const requestFrame = () => {
    if (stopped || drawing || pendingFrame !== null || document.hidden) return;
    pendingFrame = window.requestAnimationFrame(onFrame);
  };

  const cancelFrame = () => {
    if (pendingFrame === null) return;
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  };

  const drawFrame = (frames: number, motion: number) => {
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);
    if (scene.tint) {
      ctx.fillStyle = scene.tint;
      ctx.fillRect(0, 0, width, height);
    }
    if (scene.overlay) {
      ctx.fillStyle = scene.overlay;
      ctx.fillRect(0, 0, width, height);
    }
    lightning?.draw(ctx, width, height, clock, frames);
    if (drawsBody && scene.body !== "none") {
      drawCelestialBody(ctx, width, height, {
        body: scene.body,
        hour: scene.hour,
        sunsetGlow: scene.sunsetGlow,
        rays: scene.sunRays,
        clock,
      });
    }

    // Newest first: stars, then fireflies, then the weather particles.
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      advanceParticle(particle, motion);
      drawParticle(ctx, particle);
      if (isParticleSpent(particle, width, height)) {
        particles[i] = createParticle(particle.type, width, height, true);
      }
    }
  };

  function onFrame(timestamp: number) {
    pendingFrame = null;
    if (stopped || document.hidden) return;

    if (scene.animates && lastDrawnAt !== null && timestamp - lastDrawnAt < MIN_DRAW_INTERVAL_MS) {
      requestFrame();
      return;
    }

    const firstFrame = lastDrawnAt === null;
    const elapsed = lastDrawnAt === null ? MOTION_FRAME_MS : Math.max(0, timestamp - lastDrawnAt);
    const frames = scene.animates ? elapsed / MOTION_FRAME_MS : 0;
    if (!firstFrame) clock += elapsed;
    lastDrawnAt = timestamp;

    drawing = true;
    try {
      drawFrame(frames, capWeatherParticleMotionFrames(frames));
    } finally {
      drawing = false;
    }
    if (scene.animates) requestFrame();
  }

  const onResize = () => {
    dpr = fitCanvasToBox(canvas, ctx);
    // An animated loop picks the new size up on its next frame.
    if (!scene.animates) requestFrame();
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      hiddenPause = true;
      cancelFrame();
      return;
    }
    if (hiddenPause) {
      hiddenPause = false;
      lastDrawnAt = null;
    }
    requestFrame();
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
  observer?.observe(canvas);
  requestFrame();

  return () => {
    stopped = true;
    cancelFrame();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observer?.disconnect();
  };
}
