import type { GeneratedSheet, GeneratedSprite } from "./generation-run";
import { cutSheetBox, loadSheet, type LoadedSheet } from "./sheet-raster";
import { spriteSliceBox, type SliceSettings } from "./slice-geometry";

/**
 * Re-cuts every sprite that has a sheet from that sheet with the cut settings, without a new request. Sprites without
 * a sheet are left as they are. The new picture becomes both the original and the shown one. All or nothing: any
 * failure throws before anything is returned.
 */
export async function recutSprites(
  sprites: readonly GeneratedSprite[],
  sheets: readonly GeneratedSheet[],
  settings: SliceSettings,
): Promise<GeneratedSprite[]> {
  const loaded = new Map<number, LoadedSheet>();
  const recut: GeneratedSprite[] = [];
  for (const sprite of sprites) {
    const sheet = sprite.sheetIndex === null ? undefined : sheets[sprite.sheetIndex];
    if (sprite.sheetIndex === null || !sheet) {
      recut.push(sprite);
      continue;
    }
    let picture = loaded.get(sprite.sheetIndex);
    if (!picture) {
      picture = await loadSheet(sheet.src);
      loaded.set(sprite.sheetIndex, picture);
    }
    const box = spriteSliceBox(
      { sheetWidth: picture.width, sheetHeight: picture.height, grid: sheet.grid, position: sprite.position },
      settings,
    );
    const cut = cutSheetBox(picture, box);
    recut.push({ ...sprite, original: cut, shown: cut });
  }
  return recut;
}
