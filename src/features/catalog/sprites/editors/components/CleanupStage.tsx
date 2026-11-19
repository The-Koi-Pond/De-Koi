import { Loader2, RotateCcw } from "lucide-react";
import { useId, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { HoveredPixel } from "../hooks/use-stage-gestures";
import type { LoadPhase } from "../hooks/use-cleanup-picture";
import type { CleanupTool } from "../lib/cleanup-text";
import type { RgbaPicture } from "../lib/picture";
import { isBrushTool } from "../lib/tool-settings";
import { SHARP_PIXELS_ZOOM } from "../lib/view";
import type { PreviewBackground } from "./CleanupSettings";
import { editorButton } from "./editor-styles";

const BACKGROUND_STYLES: Record<PreviewBackground, CSSProperties> = {
  dark: { background: "#161321" },
  grid: { background: "repeating-conic-gradient(var(--secondary) 0 25%, var(--border) 0 50%) 0 0 / 40px 40px" },
  light: { background: "#f3eef8" },
  pink: { background: "#ff4fa3" },
};

type StageHandlers = {
  [Name in "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"]: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
} & { onPointerLeave: () => void };

function canvasCursor(tool: CleanupTool, picking: boolean, panning: boolean): string {
  if (panning) return "grabbing";
  if (tool === "pan") return "grab";
  if (tool === "wand" || picking) return "crosshair";
  return "none";
}

/** The picture on a canvas over the chosen background, scrollable both ways, with the brush reticle. */
export function CleanupStage({
  stageRef,
  canvasRef,
  label,
  phase,
  picture,
  zoom,
  background,
  tool,
  brushSize,
  picking,
  hover,
  panning,
  handlers,
  onZoomWheel,
  onRetry,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  label: string;
  phase: LoadPhase;
  picture: RgbaPicture | null;
  zoom: number;
  background: PreviewBackground;
  tool: CleanupTool;
  brushSize: number;
  picking: boolean;
  hover: HoveredPixel | null;
  panning: boolean;
  handlers: StageHandlers;
  onZoomWheel: (deltaY: number) => void;
  onRetry: () => void;
}) {
  const descriptionId = useId();
  const brushReticle = isBrushTool(tool) && !picking;
  const reticleSize = brushReticle ? Math.max(8, brushSize * zoom) : Math.max(12, 12 * zoom);
  return (
    <div className="relative min-h-[12rem] flex-1 overflow-hidden rounded-lg border border-[var(--border)]">
      <div
        ref={stageRef}
        className="h-full w-full overflow-auto"
        style={{ ...BACKGROUND_STYLES[background], cursor: panning ? "grabbing" : undefined }}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) onZoomWheel(event.deltaY);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        {...handlers}
      >
        <div className="flex h-max min-h-full w-max min-w-full p-4">
          {picture && (
            <div
              className="relative m-auto shrink-0"
              style={{ width: picture.width * zoom, height: picture.height * zoom }}
            >
              <canvas
                ref={canvasRef}
                aria-label={`Wand cleanup canvas for ${label}`}
                aria-describedby={descriptionId}
                title={picking ? "Pick brush color" : "Edit sprite transparency"}
                className="block h-full w-full"
                style={{
                  cursor: canvasCursor(tool, picking, panning),
                  imageRendering: zoom >= SHARP_PIXELS_ZOOM ? "pixelated" : "auto",
                  touchAction: "none",
                }}
              />
              {hover && phase === "ready" && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
                  style={{
                    width: reticleSize,
                    height: reticleSize,
                    left: (hover.x + 0.5) * zoom - reticleSize / 2,
                    top: (hover.y + 0.5) * zoom - reticleSize / 2,
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <p id={descriptionId} className="sr-only">
        Click or drag on the picture with a mouse, pen or finger. Use Undo to step back.
      </p>
      {phase === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 size="1.5rem" className="animate-spin text-white" aria-label="Loading sprite" />
        </div>
      )}
      {phase === "failed" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button type="button" onClick={onRetry} className={editorButton}>
            <RotateCcw size="0.875rem" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
