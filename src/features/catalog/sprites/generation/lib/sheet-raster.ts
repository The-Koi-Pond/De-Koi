import type { PixelBox } from "./slice-geometry";

/** A loaded sheet picture. */
export interface LoadedSheet {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export function loadSheet(dataUrl: string): Promise<LoadedSheet> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Sprite sheet could not be loaded"));
    image.src = dataUrl;
  });
}

/** That box of the sheet, at its own size, as a PNG data URL. */
export function cutSheetBox(sheet: LoadedSheet, box: PixelBox): string {
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(sheet.image, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  return canvas.toDataURL("image/png");
}
