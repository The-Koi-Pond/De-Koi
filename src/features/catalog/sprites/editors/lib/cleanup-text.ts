import type { BrushMode } from "./brush";
import type { Rgba } from "./picture";
import type { WandSettings } from "./wand";

/** The cleanup editor's tools. Brush paints (Color mode) or restores (Restore mode). */
export type CleanupTool = "wand" | "clean" | "erase" | "brush" | "blur" | "pan";
export type BrushPaintMode = "color" | "restore";

export function formatRgba(rgba: Rgba): string {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`;
}

export function wandRemovedText(removed: number, settings: WandSettings, target: Rgba): string {
  const wand = settings.strong ? "strong wand" : "wand";
  return `${removed.toLocaleString()} px removed with ${wand} (${settings.softness}% softness, ${settings.feather}% feather) from ${formatRgba(target)}`;
}

const STROKE_ACTIONS: Record<BrushMode, string> = {
  clean: "target-cleaned",
  erase: "erased",
  paint: "painted",
  restore: "restored",
  blur: "edge-blurred",
};

export function strokeChangedText(mode: BrushMode, changedPixels: number): string {
  return `${changedPixels.toLocaleString()} px ${STROKE_ACTIONS[mode]}`;
}

export function pickedColorText(rgba: Rgba): string {
  return `Brush color picked: ${formatRgba(rgba)}`;
}

export function readoutText(hover: { x: number; y: number; rgba: Rgba } | null): string {
  if (!hover) return "Move over the sprite to sample pixels";
  return `x ${hover.x}, y ${hover.y} · ${formatRgba(hover.rgba)}`;
}

export const CLEANUP_TEXT = {
  noOpaquePixels: "No opaque pixels selected",
  noPixelsChanged: "No pixels changed",
  panning: "Panning",
  undo: "Undo applied",
  redo: "Redo applied",
  reset: "Reset",
  wandDefaults: "Wand settings reset",
  pickOn: "Click the sprite to pick a brush color",
  pickOff: "Brush color picker canceled",
  loadFailed: "Sprite image could not be loaded. Try again.",
  saveFailed: "Couldn't save sprite cleanup. Try again.",
} as const;

/** What the status line says before anything happens: a hint for the chosen tool. */
export function idleHint(tool: CleanupTool, paintMode: BrushPaintMode): string {
  switch (tool) {
    case "wand":
      return "Click the background to remove it.";
    case "clean":
      return "Drag over leftover background to clean it.";
    case "erase":
      return "Drag to erase.";
    case "brush":
      return paintMode === "restore" ? "Drag to bring back the original." : "Drag to paint.";
    case "blur":
      return "Drag along jagged edges to smooth them.";
    case "pan":
      return "Drag to move the view.";
  }
}

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
