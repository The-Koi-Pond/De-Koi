import { afterEach, describe, expect, it, vi } from "vitest";
import { createParticle, createSceneParticles, type Particle } from "./particles";
import {
  diffStep,
  expandOps,
  loadScenarios,
  mulberry32,
  replayScenario,
  type ReplayedStep,
} from "./weather-replay-harness";
import { describeWeatherScene, type ParticleType } from "./weather-scene";

// Seeded recordings: with a real (seeded) random, the exact numbers depend on the order random numbers are
// drawn in, so these tests check shape and ranges instead of exact values.
const seededScenarios = loadScenarios("recorded-seeded.json");

const W = 640;
const H = 360;

/** value = base + scale·r with 0 ≤ r < 1 (scale 0 means a fixed value), from the spec's particle table. */
type Linear = readonly [base: number, scale: number];
type LinearField = "vy" | "vx" | "size" | "opacity" | "maxLife";

const SPEC_FIELDS: Record<ParticleType, Record<LinearField, Linear>> = {
  rain: { vy: [8, 6], vx: [-1, -2], size: [1.5, 0], opacity: [0.25, 0.2], maxLife: [200, 0] },
  snow: { vy: [0.5, 1.2], vx: [-0.3, 0.6], size: [2, 3], opacity: [0.4, 0.3], maxLife: [800, 0] },
  leaf: { vy: [0.8, 1], vx: [1.5, 2], size: [4, 3], opacity: [0.5, 0.3], maxLife: [500, 0] },
  petal: { vy: [0.4, 0.8], vx: [0.5, 1], size: [3, 3], opacity: [0.4, 0.3], maxLife: [600, 0] },
  firefly: { vy: [-0.2, 0.4], vx: [-0.3, 0.6], size: [2, 2], opacity: [0.35, 0.3], maxLife: [300, 300] },
  star: { vy: [0, 0], vx: [0, 0], size: [1, 1.5], opacity: [0.3, 0.4], maxLife: [400, 400] },
  fog: { vy: [0, 0], vx: [0.2, 0.4], size: [60, 80], opacity: [0.03, 0.04], maxLife: [1000, 0] },
  dust: { vy: [-0.1, 0.2], vx: [-0.1, 0.2], size: [1, 2], opacity: [0.15, 0.15], maxLife: [600, 400] },
  ember: { vy: [-1.5, -1.5], vx: [-0.5, 1], size: [2, 2], opacity: [0.6, 0.3], maxLife: [300, 200] },
  ash: { vy: [0.3, 0.6], vx: [-0.4, 0.8], size: [2, 3], opacity: [0.2, 0.2], maxLife: [700, 300] },
  sand: { vy: [0.5, 1], vx: [4, 4], size: [1, 2], opacity: [0.3, 0.3], maxLife: [250, 150] },
  hail: { vy: [10, 6], vx: [-1, -1], size: [2, 3], opacity: [0.4, 0.3], maxLife: [150, 0] },
  aurora: { vy: [0, 0], vx: [0.1, 0.2], size: [80, 120], opacity: [0.04, 0.03], maxLife: [1200, 600] },
};

/** Start position as base + scale·r, per type (respawned particles start at y = −10 unless the type sets y). */
function positionSpec(type: ParticleType, respawn: boolean): { x: Linear; y: Linear } {
  const x: Linear = type === "sand" ? [-10, 0] : [0, W];
  if (type === "ember") return { x, y: [H + 10, 0] };
  if (type === "star") return { x, y: [0, H * 0.4] };
  if (type === "aurora") return { x, y: [0, H * 0.35] };
  return { x, y: respawn ? [-10, 0] : [0, H] };
}

const COLOR_SPEC: Partial<Record<ParticleType, { alpha: string; channels: Linear[] }>> = {
  ash: {
    alpha: "0.6",
    channels: [
      [100, 40],
      [90, 30],
      [90, 30],
    ],
  },
  sand: {
    alpha: "0.7",
    channels: [
      [200, 30],
      [170, 30],
      [110, 20],
    ],
  },
};

const EPSILON = 1e-9;

/** The r behind a value, checked to lie in [0, 1) (or the value to be exact when the field is fixed). */
function drawnR(particle: Particle, field: string, value: number, [base, scale]: Linear): number | null {
  if (scale === 0) {
    expect(value, `${particle.type}.${field}`).toBeCloseTo(base, 9);
    return null;
  }
  const r = (value - base) / scale;
  expect(r, `${particle.type}.${field} = ${value}`).toBeGreaterThanOrEqual(-EPSILON);
  expect(r, `${particle.type}.${field} = ${value}`).toBeLessThan(1);
  return r;
}

/** Check every field of a fresh particle against the spec; return the random numbers it was built from. */
function checkParticle(particle: Particle, respawn: boolean): Record<string, number> {
  const draws: Record<string, number> = {};
  const record = (field: string, value: number, spec: Linear) => {
    const r = drawnR(particle, field, value, spec);
    if (r !== null) draws[field] = r;
  };
  const position = positionSpec(particle.type, respawn);
  record("x", particle.x, position.x);
  record("y", particle.y, position.y);
  record("wobble", particle.wobble, [0, Math.PI * 2]);
  for (const [field, spec] of Object.entries(SPEC_FIELDS[particle.type]) as [LinearField, Linear][]) {
    record(field, particle[field], spec);
  }
  expect(particle.life).toBe(0);

  const colorSpec = COLOR_SPEC[particle.type];
  if (colorSpec) {
    const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(particle.color);
    expect(match, particle.color).not.toBeNull();
    expect(match![4]).toBe(colorSpec.alpha);
    colorSpec.channels.forEach(([base, scale], i) => {
      const channel = Number(match![i + 1]);
      expect(channel).toBeGreaterThanOrEqual(base);
      expect(channel).toBeLessThan(base + scale);
    });
  }
  return draws;
}

/** Particles of one type must differ, and no two random fields may move in lockstep. */
function checkIndependentDraws(type: string, draws: Record<string, number>[]) {
  expect(draws.length, type).toBeGreaterThan(1);
  const fields = Object.keys(draws[0]);
  for (const field of fields) {
    const distinct = new Set(draws.map((d) => d[field]));
    expect(distinct.size, `${type}.${field} differs between particles`).toBeGreaterThan(1);
  }
  for (const [i, a] of fields.entries()) {
    for (const b of fields.slice(i + 1)) {
      const lockstep = draws.every((d) => Math.abs(d[a] - d[b]) < EPSILON);
      expect(lockstep, `${type}: ${a} and ${b} use their own random numbers`).toBe(false);
    }
  }
}

function groupByType(particles: Particle[]) {
  const groups = new Map<ParticleType, Particle[]>();
  for (const particle of particles) groups.set(particle.type, [...(groups.get(particle.type) ?? []), particle]);
  return groups;
}

describe("WeatherEffects with a seeded random", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(seededScenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s: new and respawned particles stay in the spec's ranges and draw their own numbers",
    (_id, scenario) => {
      const { seed } = scenario.random as { seed: number };
      vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));
      const scene = describeWeatherScene(scenario.props.weather, scenario.props.timeOfDay, true);
      const particles = createSceneParticles(scene, W, H);

      expect(particles.length).toBe(scene.count + (scene.fireflies ? 15 : 0) + (scene.stars ? 30 : 0));
      for (const [type, group] of groupByType(particles)) {
        checkIndependentDraws(
          type,
          group.map((particle) => checkParticle(particle, false)),
        );
        const respawned = group.map(() => createParticle(type, W, H, true));
        checkIndependentDraws(
          `respawned ${type}`,
          respawned.map((particle) => checkParticle(particle, true)),
        );
      }
    },
  );

  it.each(seededScenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s: renders frames shaped like the recording",
    async (_id, scenario) => {
      const replayed: ReplayedStep[] = await replayScenario(scenario);
      const [mount, frames] = replayed;
      const [recordedMount, recordedFrames] = scenario.steps;

      // Mounting draws no random-dependent calls, so it matches exactly.
      expect(diffStep(mount, recordedMount)).toEqual([]);

      expect(frames.step).toEqual(recordedFrames.step);
      expect(frames.html).toBe(recordedFrames.html);
      expect(frames.size).toEqual(recordedFrames.size);
      expect(frames.events).toBe(recordedFrames.events);
      expect(frames.counts).toHaveLength(recordedFrames.counts!.length);
      expect(frames.counts!.every((count) => count > 0)).toBe(true);

      for (const recorded of recordedFrames.logged!) {
        const got = frames.logged!.find((entry) => entry.index === recorded.index);
        expect(got?.ts).toBe(recorded.ts);
        const expected = expandOps(recorded.ops);
        // The second frame draws every particle (none has faded out yet), so the call sequence matches.
        if (recorded.index === 1) expect(got!.ops.map((op) => op[0])).toEqual(expected.map((op) => op[0]));
        for (const op of got!.ops) {
          for (const arg of op.slice(1)) if (typeof arg === "number") expect(Number.isFinite(arg)).toBe(true);
          if (op[0] === "=globalAlpha") {
            expect(op[1] as number).toBeGreaterThan(0);
            expect(op[1] as number).toBeLessThanOrEqual(1);
          }
        }
      }
    },
  );
});
