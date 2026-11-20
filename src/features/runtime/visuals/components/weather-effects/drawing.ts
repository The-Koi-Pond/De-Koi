// ──────────────────────────────────────────────
// Weather effects: drawing particles, the sun and the moon on a 2D canvas
// ──────────────────────────────────────────────
import type { Particle } from "./particles";

const TAU = Math.PI * 2;
/** A color alpha rounded to 3 decimals, so it prints the same in every browser. */
const alpha3 = (value: number) => Math.round(value * 1000) / 1000;

/** Fade in over this many frames of life. */
const FADE_IN_FRAMES = 60;

type Ctx = CanvasRenderingContext2D;
type ColorStop = readonly [offset: number, color: string];

function radialGradient(
  ctx: Ctx,
  from: readonly [x: number, y: number, r: number],
  to: readonly [x: number, y: number, r: number],
  stops: readonly ColorStop[],
): CanvasGradient {
  const gradient = ctx.createRadialGradient(from[0], from[1], from[2], to[0], to[1], to[2]);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function fillCircle(ctx: Ctx, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

/** A soft round blob: radial gradient from the center out to `radius`, filled as a circle. */
function fillGlowDot(ctx: Ctx, p: Particle, radius: number, stops: readonly ColorStop[]): void {
  ctx.fillStyle = radialGradient(ctx, [p.x, p.y, 0], [p.x, p.y, radius], stops);
  fillCircle(ctx, p.x, p.y, radius);
}

/** A rotated ellipse (leaves, petals, ash flakes). */
function fillTumblingFlake(ctx: Ctx, p: Particle, fill: string, flatness: number): void {
  ctx.fillStyle = fill;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.wobble);
  ctx.beginPath();
  ctx.ellipse(0, 0, p.size, p.size * flatness, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawAurora(ctx: Ctx, p: Particle): void {
  const hue = (p.wobble * 60 + p.life * 0.3) % 360;
  const hue40 = (hue + 40) % 360;
  const hue80 = (hue + 80) % 360;
  const gradient = ctx.createLinearGradient(p.x, p.y - p.size, p.x, p.y + p.size);
  gradient.addColorStop(0, `hsla(${hue},80%,60%,0)`);
  gradient.addColorStop(0.3, `hsla(${hue},80%,60%,0.08)`);
  gradient.addColorStop(0.5, `hsla(${hue40},70%,55%,0.12)`);
  gradient.addColorStop(0.7, `hsla(${hue80},80%,60%,0.08)`);
  gradient.addColorStop(1, `hsla(${hue80},80%,60%,0)`);
  ctx.fillStyle = gradient;

  const halfWidth = p.size * 0.6;
  const sway = Math.sin(p.life * 0.008 + p.wobble) * 30;
  ctx.beginPath();
  ctx.moveTo(p.x + sway - halfWidth, p.y - p.size);
  ctx.quadraticCurveTo(p.x + sway / 2, p.y, p.x + sway + halfWidth, p.y + p.size);
  ctx.lineTo(p.x + sway - halfWidth, p.y + p.size);
  ctx.quadraticCurveTo(p.x + sway / 2, p.y, p.x + sway + halfWidth, p.y - p.size);
  ctx.closePath();
  ctx.fill();
}

function drawParticleShape(ctx: Ctx, p: Particle): void {
  switch (p.type) {
    case "rain":
      ctx.strokeStyle = "rgba(180,210,255,0.8)";
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx * 2, p.y + p.vy * 2);
      ctx.stroke();
      return;
    case "snow":
      fillGlowDot(ctx, p, p.size, [
        [0, "rgba(255,255,255,0.9)"],
        [1, "rgba(255,255,255,0)"],
      ]);
      return;
    case "leaf":
      fillTumblingFlake(ctx, p, `hsl(${100 + Math.sin(p.wobble) * 30}, 60%, 45%)`, 0.4);
      return;
    case "petal":
      fillTumblingFlake(ctx, p, `hsl(${340 + Math.sin(p.wobble) * 15}, 80%, 80%)`, 0.5);
      return;
    case "fog":
      fillGlowDot(ctx, p, p.size, [
        [0, "rgba(200,200,220,0.06)"],
        [1, "rgba(200,200,220,0)"],
      ]);
      return;
    case "dust":
      ctx.fillStyle = "rgba(255,240,220,0.6)";
      fillCircle(ctx, p.x, p.y, p.size);
      return;
    case "ember": {
      const pulse = Math.sin(p.life * 0.08) * 0.3 + 0.7;
      fillGlowDot(ctx, p, p.size * 2.5, [
        [0, `rgba(255,200,60,${pulse})`],
        [0.4, `rgba(255,100,20,${pulse * 0.6})`],
        [1, "rgba(255,60,10,0)"],
      ]);
      return;
    }
    case "ash":
      fillTumblingFlake(ctx, p, p.color, 0.3);
      return;
    case "sand":
      ctx.fillStyle = p.color;
      fillCircle(ctx, p.x, p.y, p.size);
      return;
    case "hail": {
      const offset = p.size * 0.3;
      ctx.fillStyle = radialGradient(
        ctx,
        [p.x - offset, p.y - offset, 0],
        [p.x, p.y, p.size],
        [
          [0, "rgba(255,255,255,0.95)"],
          [0.7, "rgba(200,220,255,0.7)"],
          [1, "rgba(180,200,240,0.3)"],
        ],
      );
      fillCircle(ctx, p.x, p.y, p.size);
      return;
    }
    case "aurora":
      drawAurora(ctx, p);
      return;
    case "firefly": {
      // A warm glow that slowly brightens and dims.
      const glow = alpha3(Math.sin(p.life * 0.05 + p.wobble) * 0.35 + 0.65);
      fillGlowDot(ctx, p, p.size * 2.5, [
        [0, `rgba(240,255,150,${glow})`],
        [0.35, `rgba(200,240,90,${alpha3(glow * 0.5)})`],
        [1, "rgba(180,230,60,0)"],
      ]);
      return;
    }
    case "star": {
      // A small point that twinkles.
      const twinkle = alpha3(Math.sin(p.life * 0.06 + p.wobble) * 0.3 + 0.7);
      ctx.fillStyle = `rgba(235,240,255,${twinkle})`;
      fillCircle(ctx, p.x, p.y, p.size * 0.6);
      return;
    }
  }
}

/** Draw one particle faded by its age; a fully faded particle makes no canvas calls. */
export function drawParticle(ctx: Ctx, p: Particle): void {
  const fadeIn = Math.min(p.life / FADE_IN_FRAMES, 1);
  const fadeOut = Math.max(1 - p.life / p.maxLife, 0);
  const alpha = p.opacity * fadeIn * fadeOut;
  if (alpha <= 0) return;

  ctx.globalAlpha = alpha;
  drawParticleShape(ctx, p);
  ctx.globalAlpha = 1;
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

interface SunLook {
  sunsetGlow: boolean;
  rays: boolean;
  /** Animation clock in ms; turns and pulses the rays. */
  clock: number;
}

/** The sun's spot for an hour: rising at the left at 6, highest at noon, setting at the right at 18. */
function sunPosition(width: number, height: number, hour: number) {
  const t = clamp01((hour - 6) / 12);
  return {
    x: width * 0.08 + t * width * 0.84,
    y: height * 0.05 + (1 - Math.sin(t * Math.PI)) * height * 0.25,
  };
}

/** The moon's spot for an hour: rising at the left at 21, highest around 0:30, setting by 4. */
function moonPosition(width: number, height: number, hour: number) {
  const across = hour >= 12 ? ((hour - 21 + 24) % 24) / 10 : (hour + 3) / 10;
  const arc = hour >= 12 ? (hour - 21) / 7 : (hour + 3) / 7;
  return {
    x: width * 0.1 + clamp01(across) * width * 0.8,
    y: height * 0.05 + (1 - Math.sin(clamp01(arc) * Math.PI)) * height * 0.2,
  };
}

function drawSunRays(ctx: Ctx, x: number, y: number, radius: number, look: SunLook): void {
  const spread = 0.08;
  const color = look.sunsetGlow ? "rgba(255,160,60,0.5)" : "rgba(255,250,200,0.4)";
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * TAU + look.clock * 0.00012;
    const pulse = 0.8 + Math.sin(look.clock * 0.0006 + i * 1.5) * 0.2;
    const length = radius * (3.5 + pulse * 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle - spread) * length, y + Math.sin(angle - spread) * length);
    ctx.lineTo(x + Math.cos(angle + spread) * length, y + Math.sin(angle + spread) * length);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSun(ctx: Ctx, width: number, height: number, hour: number, look: SunLook): void {
  const { x, y } = sunPosition(width, height, hour);
  const radius = Math.min(width, height) * 0.035;
  const sunset = look.sunsetGlow;
  ctx.save();

  if (sunset) {
    ctx.fillStyle = radialGradient(
      ctx,
      [x, y, radius],
      [x, y + radius * 6, radius * 12],
      [
        [0, "rgba(255,140,50,0.12)"],
        [0.4, "rgba(255,80,30,0.06)"],
        [1, "rgba(255,40,20,0)"],
      ],
    );
    ctx.fillRect(0, 0, width, height);
  }

  const glow = radialGradient(
    ctx,
    [x, y, radius * 0.5],
    [x, y, radius * 4],
    [
      [0, sunset ? "rgba(255,120,40,0.15)" : "rgba(255,240,180,0.12)"],
      [0.5, sunset ? "rgba(255,80,20,0.05)" : "rgba(255,240,180,0.04)"],
      [1, "rgba(255,240,180,0)"],
    ],
  );
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  fillCircle(ctx, x, y, radius * 4);

  const disc = radialGradient(
    ctx,
    [x, y, 0],
    [x, y, radius],
    sunset
      ? [
          [0, "rgba(255,200,100,0.9)"],
          [0.7, "rgba(255,120,40,0.7)"],
          [1, "rgba(255,80,20,0.3)"],
        ]
      : [
          [0, "rgba(255,250,220,0.8)"],
          [0.7, "rgba(255,240,180,0.5)"],
          [1, "rgba(255,230,150,0.2)"],
        ],
  );
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = disc;
  fillCircle(ctx, x, y, radius);

  if (look.rays) drawSunRays(ctx, x, y, radius, look);
  ctx.restore();
}

function drawMoon(ctx: Ctx, width: number, height: number, hour: number): void {
  const { x, y } = moonPosition(width, height, hour);
  const r = Math.min(width, height) * 0.035 * 1.1;
  ctx.save();

  const glow = radialGradient(
    ctx,
    [x, y, r * 0.5],
    [x, y, r * 5],
    [
      [0, "rgba(180,200,255,0.10)"],
      [0.4, "rgba(150,180,255,0.04)"],
      [1, "rgba(150,180,255,0)"],
    ],
  );
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  fillCircle(ctx, x, y, r * 5);

  const disc = radialGradient(
    ctx,
    [x - r * 0.15, y - r * 0.15, 0],
    [x, y, r],
    [
      [0, "rgba(230,235,255,0.85)"],
      [0.8, "rgba(200,210,240,0.6)"],
      [1, "rgba(180,190,220,0.3)"],
    ],
  );
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = disc;
  fillCircle(ctx, x, y, r);

  // Bite a crescent out of the disc.
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "black";
  fillCircle(ctx, x + r * 0.45, y - r * 0.1, r * 0.85);
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "rgba(150,160,190,1)";
  fillCircle(ctx, x - r * 0.25, y - r * 0.15, r * 0.12);
  fillCircle(ctx, x - r * 0.4, y + r * 0.25, r * 0.08);
  fillCircle(ctx, x - r * 0.05, y + r * 0.35, r * 0.1);

  ctx.restore();
}

export interface CelestialLook extends SunLook {
  body: "sun" | "moon";
  /** 0–23, or -1 for unknown (drawn as noon). */
  hour: number;
}

export function drawCelestialBody(ctx: Ctx, width: number, height: number, look: CelestialLook): void {
  const hour = look.hour >= 0 ? look.hour : 12;
  if (look.body === "sun") drawSun(ctx, width, height, hour, look);
  else drawMoon(ctx, width, height, hour);
}
