/**
 * A picture as plain RGBA: 4 bytes per pixel (red, green, blue, alpha), rows top to bottom, not premultiplied. The
 * pixel rules work on this shape only, so they run without a canvas.
 */
export interface RgbaPicture {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

export function copyPicture(picture: RgbaPicture): RgbaPicture {
  return { width: picture.width, height: picture.height, data: new Uint8ClampedArray(picture.data) };
}

export function samePixels(a: RgbaPicture, b: RgbaPicture): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

export function pixelAt(picture: RgbaPicture, x: number, y: number): Rgba {
  const offset = (y * picture.width + x) * 4;
  const { data } = picture;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Straight-line RGB distance between the pixel at `offset` and a colour, ignoring alpha. */
export function distanceToColor(data: Uint8ClampedArray, offset: number, color: Rgb | Rgba): number {
  const red = data[offset] - color[0];
  const green = data[offset + 1] - color[1];
  const blue = data[offset + 2] - color[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

/** Straight-line RGB distance between two pixels of the same data, ignoring alpha. */
export function distanceBetween(data: Uint8ClampedArray, first: number, second: number): number {
  const red = data[first] - data[second];
  const green = data[first + 1] - data[second + 1];
  const blue = data[first + 2] - data[second + 2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

/** Offsets of the up to 8 pixels around a pixel: sides first, then corners. */
export const SIDE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const ALL_STEPS: ReadonlyArray<readonly [number, number]> = [...SIDE_STEPS, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Weight of a 3×3 block cell for the smoothing passes: sides 1, corners 1/√2 (the centre is set by each caller). */
export function blockWeight(dx: number, dy: number, centre: number): number {
  if (dx === 0 && dy === 0) return centre;
  return dx === 0 || dy === 0 ? 1 : Math.SQRT1_2;
}
