// ──────────────────────────────────────────────
// Weather effects: particle creation, movement and respawn
// ──────────────────────────────────────────────
import type { ParticleType, WeatherScene } from "./weather-scene";

export interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  wobble: number;
  life: number;
  maxLife: number;
  /** Fill color, only for ash and sand. */
  color: string;
}

const TAU = Math.PI * 2;
const FIREFLY_COUNT = 15;
const STAR_COUNT = 30;
/** How far past the canvas edge a particle may drift before it respawns. */
const EDGE_MARGIN = 20;

type Shape = (particle: Particle, width: number, height: number) => void;

const rand = () => Math.random();

/** Per-type fields; each `rand()` is a fresh draw so particles of one type differ field by field. */
const SHAPES: Record<ParticleType, Shape> = {
  rain: (p) => {
    p.vy = 8 + 6 * rand();
    p.vx = -1 - 2 * rand();
    p.size = 1.5;
    p.opacity = 0.25 + 0.2 * rand();
    p.maxLife = 200;
  },
  snow: (p) => {
    p.vy = 0.5 + 1.2 * rand();
    p.vx = -0.3 + 0.6 * rand();
    p.size = 2 + 3 * rand();
    p.opacity = 0.4 + 0.3 * rand();
    p.maxLife = 800;
  },
  leaf: (p) => {
    p.vy = 0.8 + rand();
    p.vx = 1.5 + 2 * rand();
    p.size = 4 + 3 * rand();
    p.opacity = 0.5 + 0.3 * rand();
    p.maxLife = 500;
  },
  petal: (p) => {
    p.vy = 0.4 + 0.8 * rand();
    p.vx = 0.5 + rand();
    p.size = 3 + 3 * rand();
    p.opacity = 0.4 + 0.3 * rand();
    p.maxLife = 600;
  },
  firefly: (p) => {
    p.vy = -0.2 + 0.4 * rand();
    p.vx = -0.3 + 0.6 * rand();
    p.size = 2 + 2 * rand();
    p.opacity = 0;
    p.maxLife = 300 + 300 * rand();
  },
  star: (p, _width, height) => {
    p.vy = 0;
    p.vx = 0;
    p.size = 1 + 1.5 * rand();
    p.opacity = 0;
    p.maxLife = 400 + 400 * rand();
    p.y = rand() * height * 0.4;
  },
  fog: (p) => {
    p.vy = 0;
    p.vx = 0.2 + 0.4 * rand();
    p.size = 60 + 80 * rand();
    p.opacity = 0.03 + 0.04 * rand();
    p.maxLife = 1000;
  },
  dust: (p) => {
    p.vy = -0.1 + 0.2 * rand();
    p.vx = -0.1 + 0.2 * rand();
    p.size = 1 + 2 * rand();
    p.opacity = 0.15 + 0.15 * rand();
    p.maxLife = 600 + 400 * rand();
  },
  ember: (p, _width, height) => {
    p.vy = -1.5 - 1.5 * rand();
    p.vx = -0.5 + rand();
    p.size = 2 + 2 * rand();
    p.opacity = 0.6 + 0.3 * rand();
    p.maxLife = 300 + 200 * rand();
    p.y = height + 10;
  },
  ash: (p) => {
    p.vy = 0.3 + 0.6 * rand();
    p.vx = -0.4 + 0.8 * rand();
    p.size = 2 + 3 * rand();
    p.opacity = 0.2 + 0.2 * rand();
    p.maxLife = 700 + 300 * rand();
    const red = Math.floor(100 + 40 * rand());
    const green = Math.floor(90 + 30 * rand());
    const blue = Math.floor(90 + 30 * rand());
    p.color = `rgba(${red},${green},${blue},0.6)`;
  },
  sand: (p) => {
    p.vy = 0.5 + rand();
    p.vx = 4 + 4 * rand();
    p.size = 1 + 2 * rand();
    p.opacity = 0.3 + 0.3 * rand();
    p.maxLife = 250 + 150 * rand();
    p.x = -10;
    const red = Math.floor(200 + 30 * rand());
    const green = Math.floor(170 + 30 * rand());
    const blue = Math.floor(110 + 20 * rand());
    p.color = `rgba(${red},${green},${blue},0.7)`;
  },
  hail: (p) => {
    p.vy = 10 + 6 * rand();
    p.vx = -1 - rand();
    p.size = 2 + 3 * rand();
    p.opacity = 0.4 + 0.3 * rand();
    p.maxLife = 150;
  },
  aurora: (p, _width, height) => {
    p.vy = 0;
    p.vx = 0.1 + 0.2 * rand();
    p.size = 80 + 120 * rand();
    p.opacity = 0.04 + 0.03 * rand();
    p.maxLife = 1200 + 600 * rand();
    p.y = rand() * height * 0.35;
  },
};

/**
 * A new particle of `type` somewhere on a `width × height` canvas. A respawned particle enters from
 * just above the top edge instead (ember, star and aurora still pick their own height).
 */
export function createParticle(type: ParticleType, width: number, height: number, respawn = false): Particle {
  const particle: Particle = {
    type,
    x: rand() * width,
    y: respawn ? -10 : rand() * height,
    vx: 0,
    vy: 0,
    size: 0,
    opacity: 0,
    wobble: rand() * TAU,
    life: 0,
    maxLife: 0,
    color: "",
  };
  SHAPES[type](particle, width, height);
  return particle;
}

/** The scene's particles in creation order: weather type, then fireflies, then stars. */
export function createSceneParticles(scene: WeatherScene, width: number, height: number): Particle[] {
  const batch = (type: ParticleType, count: number) =>
    Array.from({ length: count }, () => createParticle(type, width, height));
  return [
    ...batch(scene.type, scene.count),
    ...batch("firefly", scene.fireflies ? FIREFLY_COUNT : 0),
    ...batch("star", scene.stars ? STAR_COUNT : 0),
  ];
}

/** Move a particle by `motion` frames' worth of velocity, life and sway. */
export function advanceParticle(p: Particle, motion: number): void {
  p.life += motion;
  p.x += p.vx * motion;
  p.y += p.vy * motion;

  switch (p.type) {
    case "snow":
    case "leaf":
    case "petal":
    case "ash":
      p.wobble += 0.02 * motion;
      p.x += Math.sin(p.wobble) * 0.5 * motion;
      break;
    case "ember":
      p.wobble += 0.04 * motion;
      p.x += Math.sin(p.wobble) * 0.6 * motion;
      break;
    case "firefly":
      p.wobble += 0.03 * motion;
      p.x += Math.sin(p.wobble) * 0.8 * motion;
      p.y += Math.cos(p.wobble * 0.7) * 0.4 * motion;
      break;
    default:
      break;
  }
}

/** True once a particle has left the canvas (with some margin) or outlived its life. */
export function isParticleSpent(p: Particle, width: number, height: number): boolean {
  return (
    p.y > height + EDGE_MARGIN ||
    p.y < -EDGE_MARGIN ||
    p.x > width + EDGE_MARGIN ||
    p.x < -EDGE_MARGIN ||
    p.life > p.maxLife
  );
}
