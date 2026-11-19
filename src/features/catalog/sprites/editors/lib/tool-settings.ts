import { brushRadius, type BrushSettings } from "./brush";
import { hexToRgb, type BrushPaintMode, type CleanupTool } from "./cleanup-text";
import { pixelAt, type RgbaPicture } from "./picture";

/** The brush tools' controls as the user sets them (sliders 0–100 unless noted). */
export interface BrushControls {
  /** Brush size, 2–96. */
  size: number;
  /** Clean's own Tolerance (4–128), Edge guard and Feather. */
  cleanTolerance: number;
  edgeGuard: number;
  cleanFeather: number;
  /** Shared by Erase, Color and Restore. */
  opacity: number;
  hardness: number;
  /** Blur's strength. */
  strength: number;
  paintMode: BrushPaintMode;
  /** The paint colour as `#rrggbb`. */
  color: string;
}

export const DEFAULT_BRUSH_CONTROLS: BrushControls = {
  size: 18,
  cleanTolerance: 36,
  edgeGuard: 45,
  cleanFeather: 8,
  opacity: 100,
  hardness: 100,
  strength: 65,
  paintMode: "color",
  color: "#ffffff",
};

export type BrushTool = Extract<CleanupTool, "clean" | "erase" | "brush" | "blur">;

export function isBrushTool(tool: CleanupTool): tool is BrushTool {
  return tool === "clean" || tool === "erase" || tool === "brush" || tool === "blur";
}

/** A stroke's settings, fixed at the press. Clean's target is the pressed pixel's RGBA in the current picture. */
export function strokeSettingsFor(
  tool: BrushTool,
  controls: BrushControls,
  current: RgbaPicture,
  press: { x: number; y: number },
): BrushSettings {
  const radius = brushRadius(controls.size);
  switch (tool) {
    case "erase":
      return { mode: "erase", radius, hardness: controls.hardness, opacity: controls.opacity };
    case "brush":
      return controls.paintMode === "restore"
        ? { mode: "restore", radius, hardness: controls.hardness, opacity: controls.opacity }
        : {
            mode: "paint",
            radius,
            hardness: controls.hardness,
            opacity: controls.opacity,
            color: hexToRgb(controls.color),
          };
    case "clean":
      return {
        mode: "clean",
        radius,
        target: pixelAt(current, press.x, press.y),
        tolerance: controls.cleanTolerance,
        edgeGuard: controls.edgeGuard,
        feather: controls.cleanFeather,
      };
    case "blur":
      return { mode: "blur", radius, strength: controls.strength };
  }
}
