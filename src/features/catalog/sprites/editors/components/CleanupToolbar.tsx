import { Brush, Droplets, Eraser, Hand, Sparkles, Wand2, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";

import type { CleanupTool } from "../lib/cleanup-text";
import { zoomPercent } from "../lib/view";
import { editorButton, iconButton, toggleButton } from "./editor-styles";

const TOOLS: Array<{ tool: Exclude<CleanupTool, "pan">; label: string; tooltip: string; Icon: LucideIcon }> = [
  { tool: "wand", label: "Wand", tooltip: "Select connected pixels", Icon: Wand2 },
  { tool: "clean", label: "Clean", tooltip: "Brush away pixels matching the sampled color", Icon: Sparkles },
  { tool: "erase", label: "Erase", tooltip: "Paint pixels transparent", Icon: Eraser },
  { tool: "brush", label: "Brush", tooltip: "Paint color or restore original pixels", Icon: Brush },
  { tool: "blur", label: "Blur", tooltip: "Paint alpha smoothing over jagged edges", Icon: Droplets },
];

/** The tool row: the five editing tools, then Pan and the zoom group. */
export function CleanupToolbar({
  tool,
  zoom,
  disabled,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  tool: CleanupTool;
  zoom: number;
  disabled: boolean;
  onToolChange: (tool: CleanupTool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map(({ tool: option, label, tooltip, Icon }) => (
          <button
            key={option}
            type="button"
            aria-pressed={tool === option}
            title={tooltip}
            disabled={disabled}
            onClick={() => onToolChange(option)}
            className={toggleButton(tool === option)}
          >
            <Icon size="0.875rem" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Pan"
          aria-pressed={tool === "pan"}
          title="Pan (middle mouse drag also pans)"
          disabled={disabled}
          onClick={() => onToolChange("pan")}
          className={`${toggleButton(tool === "pan")} w-8 px-0`}
        >
          <Hand size="0.875rem" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={disabled}
          onClick={onZoomOut}
          className={iconButton}
        >
          <ZoomOut size="0.875rem" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Fit to view"
          title="Fit to view"
          disabled={disabled}
          onClick={onFit}
          className={`${editorButton} min-w-[3.5rem] tabular-nums`}
        >
          {zoomPercent(zoom)}
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={disabled}
          onClick={onZoomIn}
          className={iconButton}
        >
          <ZoomIn size="0.875rem" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
