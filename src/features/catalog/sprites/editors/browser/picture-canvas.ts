import type { RgbaPicture } from "../lib/picture";

// The thin browser layer between pictures and the pixel rules. Both directions go through a 2D canvas on purpose:
// the saved pixels must be the ones the browser's canvas gives back and encodes (see "Loading the picture" and "The
// saved picture" in docs/provenance/sprite-editors.md).

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");
  return context;
}

/** Decodes picture bytes, draws them at their own size and reads the canvas back as RGBA. */
export async function decodePicture(blob: Blob): Promise<RgbaPicture> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = context2d(canvas);
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Draws a picture onto a canvas of its own size. */
export function drawPicture(canvas: HTMLCanvasElement, picture: RgbaPicture): void {
  if (canvas.width !== picture.width) canvas.width = picture.width;
  if (canvas.height !== picture.height) canvas.height = picture.height;
  context2d(canvas).putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
}

/** The whole picture as a canvas PNG data URL. */
export function pictureToPngDataUrl(picture: RgbaPicture): string {
  const canvas = document.createElement("canvas");
  drawPicture(canvas, picture);
  return canvas.toDataURL("image/png");
}
