import {
  ALL_STEPS,
  SIDE_STEPS,
  blockWeight,
  clamp01,
  copyPicture,
  distanceBetween,
  distanceToColor,
  pixelAt,
  type Rgb,
  type Rgba,
  type RgbaPicture,
} from "./picture";

/** The wand's controls as the user sets them (sliders 0–100, Tolerance 4–128). */
export interface WandSettings {
  tolerance: number;
  strong: boolean;
  softness: number;
  feather: number;
}

export const DEFAULT_WAND_SETTINGS: WandSettings = { tolerance: 36, strong: false, softness: 55, feather: 12 };

export interface WandResult {
  /** The picture after the click; the same object as the input when nothing was removed. */
  picture: RgbaPicture;
  /** How many pixels the removed area holds (0 for a see-through click). */
  removed: number;
  /** The clicked pixel's RGBA before the click. */
  target: Rgba;
}

/** At or below this alpha a pixel counts as see-through. */
const SEE_THROUGH_ALPHA = 8;
/** Neighbours above this alpha take part in the edge check. */
const NEIGHBOUR_ALPHA = 32;

interface WandRule {
  tolerance: number;
  steps: ReadonlyArray<readonly [number, number]>;
  edgeGuard: number;
  growOutRounds: number;
}

function wandRule(settings: WandSettings): WandRule {
  if (!settings.strong) {
    return { tolerance: settings.tolerance, steps: SIDE_STEPS, edgeGuard: 0.55, growOutRounds: 1 };
  }
  return { tolerance: Math.round(settings.tolerance * 1.55), steps: ALL_STEPS, edgeGuard: 0.28, growOutRounds: 2 };
}

/**
 * Removes the connected area of colours like the clicked pixel and softens the cut. Every test reads `before`; the
 * result is a new picture. Spec: "The wand" in docs/provenance/sprite-editors.md.
 */
export function removeWandArea(before: RgbaPicture, x: number, y: number, settings: WandSettings): WandResult {
  const inside =
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < before.width && y < before.height;
  if (!inside) return { picture: before, removed: 0, target: [0, 0, 0, 0] };
  const target = pixelAt(before, x, y);
  if (target[3] <= SEE_THROUGH_ALPHA) return { picture: before, removed: 0, target };

  const rule = wandRule(settings);
  const area = growArea(before, y * before.width + x, target, rule);
  const picture = copyPicture(before);
  let removed = 0;
  for (let index = 0; index < area.length; index += 1) {
    if (!area[index]) continue;
    picture.data[index * 4 + 3] = 0;
    removed += 1;
  }

  const softness = settings.softness / 100;
  const feather = settings.feather / 100;
  if (softness > 0 || feather > 0) softenKeptEdge(before, picture, area, target, rule.tolerance, softness, feather);
  if (feather > 0) addSoftHalo(before, picture, area, target, rule.tolerance, softness, feather);
  return { picture, removed, target };
}

/** Steps 2–4: grow from the clicked pixel, then grow out for the rule's rounds. */
function growArea(before: RgbaPicture, start: number, target: Rgba, rule: WandRule): Uint8Array {
  const { width, height, data } = before;
  const T = rule.tolerance;
  const g = rule.edgeGuard;
  const sureMatch = T * (0.18 + 0.16 * (1 - g));
  const characterLike = T * (1.05 - 0.18 * g);
  const weakMatch = T * (0.36 + 0.32 * (1 - g));
  const crowdedShare = 0.18 + 0.42 * (1 - g);

  const edgeCheckPasses = (index: number, distance: number): boolean => {
    const px = index % width;
    const py = (index - px) / width;
    const offset = index * 4;
    let neighbours = 0;
    let characterNeighbours = 0;
    let closestCharacter = Infinity;
    for (const [dx, dy] of ALL_STEPS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbour = (ny * width + nx) * 4;
      if (data[neighbour + 3] <= NEIGHBOUR_ALPHA) continue;
      neighbours += 1;
      if (distanceToColor(data, neighbour, target) > characterLike) {
        characterNeighbours += 1;
        closestCharacter = Math.min(closestCharacter, distanceBetween(data, offset, neighbour));
      }
    }
    if (characterNeighbours === 0) return true;
    const weak = distance > weakMatch;
    const closerToCharacter = closestCharacter < distance * (1.1 + 1.15 * g) + 10 * g;
    const crowded = characterNeighbours / neighbours > crowdedShare;
    return !(weak && closerToCharacter && crowded);
  };

  const canTake = (index: number, reach: number): boolean => {
    const offset = index * 4;
    if (data[offset + 3] <= SEE_THROUGH_ALPHA) return false;
    const distance = distanceToColor(data, offset, target);
    if (distance > Math.max(1, T * reach)) return false;
    return distance <= sureMatch || edgeCheckPasses(index, distance);
  };

  const area = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  area[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const index = queue[head++];
    const px = index % width;
    const py = (index - px) / width;
    for (const [dx, dy] of rule.steps) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbour = ny * width + nx;
      if (area[neighbour] || !canTake(neighbour, 1)) continue;
      area[neighbour] = 1;
      queue[tail++] = neighbour;
    }
  }

  for (let round = 0; round < rule.growOutRounds; round += 1) {
    const reach = 1.08 + 0.08 * round;
    const joining: number[] = [];
    for (let index = 0; index < area.length; index += 1) {
      if (area[index] || !touches(area, index, width, height, rule.steps)) continue;
      if (canTake(index, reach)) joining.push(index);
    }
    for (const index of joining) area[index] = 1;
  }
  return area;
}

function touches(
  area: Uint8Array,
  index: number,
  width: number,
  height: number,
  steps: ReadonlyArray<readonly [number, number]>,
): boolean {
  const px = index % width;
  const py = (index - px) / width;
  for (const [dx, dy] of steps) {
    const nx = px + dx;
    const ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (area[ny * width + nx]) return true;
  }
  return false;
}

/**
 * Step counts (8 neighbours per step) from a set of seed pixels, walking only through pixels `canWalk` allows, up to
 * `maxStep`. Seeds are step 1; 0 means "not reached".
 */
function stepBand(
  width: number,
  height: number,
  seeds: number[],
  canWalk: (index: number) => boolean,
  maxStep: number,
): { order: number[]; steps: Uint8Array } {
  // Bands are at most 6 steps wide (1 + round(2 + 3) and 1 + round(5)), so a byte per pixel holds the count.
  const steps = new Uint8Array(width * height);
  const order: number[] = [];
  for (const seed of seeds) {
    steps[seed] = 1;
    order.push(seed);
  }
  for (let head = 0; head < order.length; head += 1) {
    const index = order[head];
    const step = steps[index];
    if (step >= maxStep) continue;
    const px = index % width;
    const py = (index - px) / width;
    for (const [dx, dy] of ALL_STEPS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbour = ny * width + nx;
      if (steps[neighbour] || !canWalk(neighbour)) continue;
      steps[neighbour] = step + 1;
      order.push(neighbour);
    }
  }
  return { order, steps };
}

interface NearbySampling {
  radius: number;
  minAlpha: number;
  separation: (distanceToTarget: number) => number;
  distancePower: number;
  alphaPower: number;
  separationPower: number;
}

/** The weighted average before-picture colour of kept pixels on a disc around a pixel, or null when none qualify. */
function nearbyColor(
  before: RgbaPicture,
  area: Uint8Array,
  index: number,
  target: Rgba,
  sampling: NearbySampling,
): { color: Rgb; weight: number } | null {
  const { width, height, data } = before;
  const px = index % width;
  const py = (index - px) / width;
  const reach = Math.ceil(sampling.radius);
  let weight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let dy = -reach; dy <= reach; dy += 1) {
    const ny = py + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx;
      if (nx < 0 || nx >= width) continue;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > sampling.radius) continue;
      const neighbour = ny * width + nx;
      if (area[neighbour]) continue;
      const offset = neighbour * 4;
      const alpha = data[offset + 3];
      if (alpha <= sampling.minAlpha) continue;
      const separation = clamp01(sampling.separation(distanceToColor(data, offset, target)));
      if (separation <= 0) continue;
      const sampleWeight =
        (1 - distance / (sampling.radius + 0.001)) ** sampling.distancePower *
        (alpha / 255) ** sampling.alphaPower *
        separation ** sampling.separationPower;
      weight += sampleWeight;
      red += data[offset] * sampleWeight;
      green += data[offset + 1] * sampleWeight;
      blue += data[offset + 2] * sampleWeight;
    }
  }
  if (weight <= 0) return null;
  return { color: [Math.round(red / weight), Math.round(green / weight), Math.round(blue / weight)], weight };
}

function luma(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Step 6: fade and de-tint the kept pixels along the cut, then smooth their alphas once. */
function softenKeptEdge(
  before: RgbaPicture,
  picture: RgbaPicture,
  area: Uint8Array,
  target: Rgba,
  T: number,
  s: number,
  f: number,
): void {
  const { width, height } = before;
  const source = before.data;
  const out = picture.data;
  const a = clamp01(0.72 * s + 0.42 * f);
  const bandWidth = 1 + Math.round(2 * s + 3 * f);
  const matteReach = Math.max(1, T * (1.14 + 0.82 * a));
  const pullAmount = clamp01((0.65 * s + 0.55 * f - 0.3) / 0.7);
  const sampleRadius = bandWidth + 2;
  const sampling: NearbySampling = {
    radius: sampleRadius,
    minAlpha: 48,
    separation: (distance) => (distance - 0.72 * matteReach) / Math.max(1, 1.55 * matteReach),
    distancePower: 1.35,
    alphaPower: 1.1,
    separationPower: 1.25,
  };

  const seeds: number[] = [];
  for (let index = 0; index < area.length; index += 1) {
    if (!area[index] && touches(area, index, width, height, ALL_STEPS)) seeds.push(index);
  }
  const band = stepBand(width, height, seeds, (index) => !area[index], bandWidth);

  // Faded alphas are whole numbers 0–255, so a byte per pixel holds them exactly.
  const faded = new Uint8Array(width * height);
  for (let index = 0; index < faded.length; index += 1) faded[index] = out[index * 4 + 3];
  const edgeWeight = (index: number) => clamp01((bandWidth - band.steps[index] + 1) / bandWidth);

  for (const index of band.order) {
    const offset = index * 4;
    const alpha = out[offset + 3];
    if (alpha === 0) continue;
    const beforeAlpha = source[offset + 3];
    const edge = edgeWeight(index);
    const distance = distanceToColor(source, offset, target);
    const matte = distance <= matteReach ? 1 - distance / matteReach : 0;
    const fragility = clamp01((248 - beforeAlpha) / (218 - 82 * a));

    if (pullAmount > 0 && matte > 0.05) {
      const nearby = nearbyColor(before, area, index, target, sampling);
      if (nearby) {
        const [nearRed, nearGreen, nearBlue] = nearby.color;
        const targetLuma = luma(target[0], target[1], target[2]);
        const nearLuma = luma(nearRed, nearGreen, nearBlue);
        const ownLuma = luma(source[offset], source[offset + 1], source[offset + 2]);
        const light =
          targetLuma > nearLuma ? clamp01((ownLuma - nearLuma - 4) / Math.max(28, targetLuma - nearLuma)) : 0;
        const dark =
          targetLuma < nearLuma ? clamp01((nearLuma - ownLuma - 4) / Math.max(28, nearLuma - targetLuma)) : 0;
        const residue = Math.max(matte, light, dark);
        const confidence = clamp01(nearby.weight / (1.4 + 0.42 * sampleRadius));
        const pull = clamp01(pullAmount * edge ** 0.88 * residue * (0.42 + 0.28 * fragility + 0.3 * confidence));
        if (pull > 0) {
          out[offset] = Math.round(source[offset] * (1 - pull) + nearRed * pull);
          out[offset + 1] = Math.round(source[offset + 1] * (1 - pull) + nearGreen * pull);
          out[offset + 2] = Math.round(source[offset + 2] * (1 - pull) + nearBlue * pull);
        }
      }
    }

    const strength = a * edge ** (0.92 + 0.28 * (1 - f)) * (0.16 + 0.58 * matte + 0.3 * fragility);
    faded[index] = Math.min(alpha, Math.round(alpha * (1 - clamp01(strength))));
  }

  for (const index of band.order) {
    const fadedAlpha = faded[index];
    if (out[index * 4 + 3] === 0 || fadedAlpha <= 0) {
      out[index * 4 + 3] = fadedAlpha;
      continue;
    }
    const px = index % width;
    const py = (index - px) / width;
    let total = 0;
    let weighted = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = py + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = px + dx;
        if (nx < 0 || nx >= width) continue;
        const weight = blockWeight(dx, dy, 1.8);
        total += weight;
        weighted += weight * faded[ny * width + nx];
      }
    }
    const average = Math.round(weighted / total);
    const mix = a * edgeWeight(index) ** 0.72 * 0.64;
    out[index * 4 + 3] = Math.min(fadedAlpha, Math.round(fadedAlpha * (1 - mix) + average * mix));
  }
}

/** Step 7: a faint, character-coloured fringe just inside the removed area. */
function addSoftHalo(
  before: RgbaPicture,
  picture: RgbaPicture,
  area: Uint8Array,
  target: Rgba,
  T: number,
  s: number,
  f: number,
): void {
  const { width, height } = before;
  const source = before.data;
  const out = picture.data;
  const haloWidth = 1 + Math.round(5 * f);
  const sampleRadius = haloWidth + 2 + Math.round(2 * s);
  const targetReach = Math.max(1, T);
  const topAlpha = 4 + f * (46 + 18 * s);
  const curve = 1.72 - 0.58 * s - 0.46 * f;
  const sampling: NearbySampling = {
    radius: sampleRadius,
    minAlpha: 28,
    separation: (distance) => (distance - 0.45 * targetReach) / (1.55 * targetReach),
    distancePower: 1.6,
    alphaPower: 1.15,
    separationPower: 1.2,
  };

  const seeds: number[] = [];
  for (let index = 0; index < area.length; index += 1) {
    if (area[index] && touchesOpaqueKept(source, area, index, width, height)) seeds.push(index);
  }
  const band = stepBand(width, height, seeds, (index) => area[index] === 1, haloWidth);

  // Halo alphas and colours are whole numbers 0–255, so bytes hold them exactly. Smoothing passes alternate between
  // two buffers instead of copying the picture-sized arrays on every pass.
  let alphas = new Uint8Array(width * height);
  let colors = new Uint8Array(width * height * 3);
  for (const index of band.order) {
    const nearby = nearbyColor(before, area, index, target, sampling);
    if (!nearby) continue;
    const edge = clamp01((haloWidth - band.steps[index] + 1) / haloWidth);
    const influence = clamp01(nearby.weight / (1.15 + 0.38 * sampleRadius));
    const alpha = Math.min(source[index * 4 + 3], Math.round(topAlpha * edge ** curve * (0.55 + 0.45 * influence)));
    if (alpha <= 0) continue;
    alphas[index] = alpha;
    colors.set(nearby.color, index * 3);
  }

  const passes = Math.round(2 * s + 2 * f);
  let nextAlphas = passes > 0 ? new Uint8Array(width * height) : alphas;
  let nextColors = passes > 0 ? new Uint8Array(width * height * 3) : colors;
  for (let pass = 0; pass < passes; pass += 1) {
    // Only halo-band pixels ever hold a halo, so only they need carrying over into the other buffer.
    for (const index of band.order) {
      const px = index % width;
      const py = (index - px) / width;
      let total = 0;
      let alphaSum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (!area[neighbour]) continue;
          const weight = blockWeight(dx, dy, 1.8);
          const alpha = alphas[neighbour];
          total += weight;
          alphaSum += weight * alpha;
          // Weight × (alpha × colour), in that order: the recorded results depend on it.
          red += weight * (alpha * colors[neighbour * 3]);
          green += weight * (alpha * colors[neighbour * 3 + 1]);
          blue += weight * (alpha * colors[neighbour * 3 + 2]);
        }
      }
      if (alphaSum <= 0) {
        nextAlphas[index] = alphas[index];
        nextColors.set(colors.subarray(index * 3, index * 3 + 3), index * 3);
        continue;
      }
      nextColors[index * 3] = Math.round(red / alphaSum);
      nextColors[index * 3 + 1] = Math.round(green / alphaSum);
      nextColors[index * 3 + 2] = Math.round(blue / alphaSum);
      nextAlphas[index] = Math.round(alphaSum / total);
    }
    [alphas, nextAlphas] = [nextAlphas, alphas];
    [colors, nextColors] = [nextColors, colors];
  }

  for (const index of band.order) {
    if (alphas[index] <= 0) continue;
    const offset = index * 4;
    out[offset] = colors[index * 3];
    out[offset + 1] = colors[index * 3 + 1];
    out[offset + 2] = colors[index * 3 + 2];
    out[offset + 3] = alphas[index];
  }
}

function touchesOpaqueKept(
  data: Uint8ClampedArray,
  area: Uint8Array,
  index: number,
  width: number,
  height: number,
): boolean {
  const px = index % width;
  const py = (index - px) / width;
  for (const [dx, dy] of ALL_STEPS) {
    const nx = px + dx;
    const ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const neighbour = ny * width + nx;
    if (!area[neighbour] && data[neighbour * 4 + 3] > SEE_THROUGH_ALPHA) return true;
  }
  return false;
}
