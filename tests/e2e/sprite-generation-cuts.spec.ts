import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { transformWithEsbuild } from "vite";

// The sprite generation dialog's cuts and frames draw on a real canvas, which jsdom doesn't have. This runs the
// dialog's own cut geometry and canvas cutting, and the shared frame crop, in Chromium on a synthetic sheet shaped like
// Rust's (512 px cells, 2×3), and compares decoded pixels rather than PNG bytes.

const MODULES = {
  geometry: "src/features/catalog/sprites/generation/lib/slice-geometry.ts",
  raster: "src/features/catalog/sprites/generation/lib/sheet-raster.ts",
  frames: "src/features/catalog/sprites/generation/lib/frame-limits.ts",
  crop: "src/shared/lib/sprite-frame-crop.ts",
};

async function browserModule(path: string): Promise<string> {
  const source = readFileSync(resolve(path), "utf8");
  return (await transformWithEsbuild(source, path, { format: "esm", loader: "ts" })).code;
}

test("cuts and frames sprites from a sheet's pixels", async ({ page }) => {
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(MODULES).map(async ([name, path]) => [name, await browserModule(path)])),
  ) as Record<keyof typeof MODULES, string>;
  await page.route("**/sprite-cut-probe", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>probe</title>" }),
  );
  await page.goto("/sprite-cut-probe");

  const result = await page.evaluate(async (code) => {
    const load = (text: string) => import(URL.createObjectURL(new Blob([text], { type: "text/javascript" })));
    const geometry = await load(code.geometry);
    const raster = await load(code.raster);
    const frames = await load(code.frames);
    const crop = await load(code.crop);

    // Six solid cells with an 8 px black border each.
    const colours = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"];
    const sheetCanvas = document.createElement("canvas");
    sheetCanvas.width = 1024;
    sheetCanvas.height = 1536;
    const context = sheetCanvas.getContext("2d")!;
    colours.forEach((colour, index) => {
      const x = (index % 2) * 512;
      const y = Math.floor(index / 2) * 512;
      context.fillStyle = "#000000";
      context.fillRect(x, y, 512, 512);
      context.fillStyle = colour;
      context.fillRect(x + 8, y + 8, 496, 496);
    });

    async function pixels(dataUrl: string, points: Array<[number, number]>) {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const drawn = canvas.getContext("2d")!;
      drawn.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        samples: points.map(([x, y]) => Array.from(drawn.getImageData(x, y, 1, 1).data.slice(0, 3)).join(",")),
      };
    }

    const sheet = await raster.loadSheet(sheetCanvas.toDataURL("image/png"));
    const settings = {
      ...geometry.zeroSliceSettings({ cols: 2, rows: 3 }),
      sideMargin: 2,
      columnCuts: [3],
      cropTop: 5,
    };
    const cell = (position: number) =>
      geometry.spriteSliceBox(
        { sheetWidth: sheet.width, sheetHeight: sheet.height, grid: { cols: 2, rows: 3 }, position },
        settings,
      );
    const first = await pixels(raster.cutSheetBox(sheet, cell(0)), [
      [0, 0],
      [522, 100],
    ]);
    const second = await pixels(raster.cutSheetBox(sheet, cell(1)), [
      [0, 0],
      [460, 470],
    ]);

    const frame = frames.setFrameEdge(frames.setFrameEdge(frames.ZERO_FRAME, "top", 10), "left", 85);
    const sprite = raster.cutSheetBox(
      sheet,
      geometry.spriteSliceBox(
        { sheetWidth: sheet.width, sheetHeight: sheet.height, grid: { cols: 2, rows: 3 }, position: 1 },
        geometry.zeroSliceSettings({ cols: 2, rows: 3 }),
      ),
    );
    const framed = await pixels(await crop.cropSpriteDataUrl(sprite, frame), [[0, 0]]);
    return { first, second, frame, framed };
  }, sources);

  // Cell 1 at x 20–543, y 26–512: the column cut took 31 px of cell 2 (its border, then its green).
  expect(result.first).toEqual({ width: 523, height: 486, samples: ["255,0,0", "0,255,0"] });
  expect(result.second).toEqual({ width: 461, height: 486, samples: ["0,255,0", "0,255,0"] });
  // Left asks for 85 and stops at 80; the frame keeps the right 20% and the bottom 90%.
  expect(result.frame).toEqual({ top: 10, bottom: 0, left: 80, right: 0 });
  expect(result.framed).toEqual({ width: 102, height: 461, samples: ["0,255,0"] });
});
