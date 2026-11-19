import type { GeneratedSheet, GeneratedSprite } from "./generation-run";
import { cutSheetBox, loadSheet, type LoadedSheet } from "./sheet-raster";
import { spriteSliceBox, type SliceSettings } from "./slice-geometry";

/**
 * Re-cuts every sprite that has a sheet from that sheet with the cut settings, without a new request, and returns the
 * new pictures by sprite id. Sprites without a sheet aren't in it. All or nothing: any failure throws before anything
 * is returned.
 */
export async function recutSprites(
  sprites: readonly GeneratedSprite[],
  sheets: readonly GeneratedSheet[],
  settings: SliceSettings,
): Promise<Map<string, string>> {
  const loaded = new Map<number, LoadedSheet>();
  const pictures = new Map<string, string>();
  for (const sprite of sprites) {
    const sheet = sprite.sheetIndex === null ? undefined : sheets[sprite.sheetIndex];
    if (sprite.sheetIndex === null || !sheet) continue;
    let picture = loaded.get(sprite.sheetIndex);
    if (!picture) {
      picture = await loadSheet(sheet.src);
      loaded.set(sprite.sheetIndex, picture);
    }
    const box = spriteSliceBox(
      { sheetWidth: picture.width, sheetHeight: picture.height, grid: sheet.grid, position: sprite.position },
      settings,
    );
    pictures.set(sprite.id, cutSheetBox(picture, box));
  }
  return pictures;
}
