import { Minus, Pipette, Plus } from "lucide-react";
import { useId } from "react";

import type { CleanupTool } from "../lib/cleanup-text";
import type { BrushControls } from "../lib/tool-settings";
import type { WandSettings } from "../lib/wand";
import { EditorSlider } from "./EditorSlider";
import { editorButton, toggleButton } from "./editor-styles";

export type PreviewBackground = "dark" | "grid" | "light" | "pink";

const BACKGROUNDS: Array<{ value: PreviewBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "grid", label: "Checkerboard" },
  { value: "light", label: "Light" },
  { value: "pink", label: "Pink" },
];

const OPACITY_TOOLTIPS = {
  erase: "How much alpha each eraser stroke removes",
  color: "How much color each brush stroke applies",
  restore: "How strongly each stroke restores the original sprite",
};

const HARDNESS_TOOLTIPS = {
  erase: "How crisp the eraser edge should be",
  color: "How crisp the brush edge should be",
  restore: "How crisp the restore brush edge should be",
};

/** The settings row: the current tool's settings on the left, the preview backgrounds on the right. */
export function CleanupSettings({
  tool,
  wand,
  brush,
  picking,
  background,
  disabled,
  onWandChange,
  onWandDefaults,
  onBrushChange,
  onTogglePick,
  onBackgroundChange,
}: {
  tool: CleanupTool;
  wand: WandSettings;
  brush: BrushControls;
  picking: boolean;
  background: PreviewBackground;
  disabled: boolean;
  onWandChange: (change: Partial<WandSettings>) => void;
  onWandDefaults: () => void;
  onBrushChange: (change: Partial<BrushControls>) => void;
  onTogglePick: () => void;
  onBackgroundChange: (background: PreviewBackground) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        {tool === "wand" && (
          <WandControls wand={wand} disabled={disabled} onChange={onWandChange} onDefaults={onWandDefaults} />
        )}
        {tool !== "wand" && tool !== "pan" && (
          <BrushToolControls
            tool={tool}
            brush={brush}
            picking={picking}
            disabled={disabled}
            onChange={onBrushChange}
            onTogglePick={onTogglePick}
          />
        )}
      </div>
      <div role="group" aria-label="Preview background" className="flex flex-wrap gap-1.5">
        {BACKGROUNDS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={background === value}
            onClick={() => onBackgroundChange(value)}
            className={toggleButton(background === value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WandControls({
  wand,
  disabled,
  onChange,
  onDefaults,
}: {
  wand: WandSettings;
  disabled: boolean;
  onChange: (change: Partial<WandSettings>) => void;
  onDefaults: () => void;
}) {
  const strongId = useId();
  return (
    <>
      <button
        type="button"
        title="Reset wand controls to their defaults"
        disabled={disabled}
        onClick={onDefaults}
        className={editorButton}
      >
        Defaults
      </button>
      <EditorSlider
        label="Tolerance"
        value={wand.tolerance}
        min={4}
        max={128}
        disabled={disabled}
        onChange={(tolerance) => onChange({ tolerance })}
      />
      <div className="flex items-center gap-1.5 text-xs" title="Reach farther into matching debris">
        <input
          id={strongId}
          type="checkbox"
          checked={wand.strong}
          disabled={disabled}
          onChange={(event) => onChange({ strong: event.target.checked })}
          className="accent-[var(--primary)]"
        />
        <label htmlFor={strongId} className="text-[var(--foreground)]">
          Strong (reaches further)
        </label>
      </div>
      <EditorSlider
        label="Softness"
        value={wand.softness}
        min={0}
        max={100}
        tooltip="0 is a hard cut; higher values leave a softer low-alpha edge"
        disabled={disabled}
        onChange={(softness) => onChange({ softness })}
      />
      <EditorSlider
        label="Feather"
        value={wand.feather}
        min={0}
        max={100}
        tooltip="How much soft border the wand leaves behind, and how gradually it fades"
        disabled={disabled}
        onChange={(feather) => onChange({ feather })}
      />
    </>
  );
}

function BrushToolControls({
  tool,
  brush,
  picking,
  disabled,
  onChange,
  onTogglePick,
}: {
  tool: Exclude<CleanupTool, "wand" | "pan">;
  brush: BrushControls;
  picking: boolean;
  disabled: boolean;
  onChange: (change: Partial<BrushControls>) => void;
  onTogglePick: () => void;
}) {
  const colorId = useId();
  const tooltipKey = tool === "erase" ? "erase" : brush.paintMode;
  return (
    <>
      <EditorSlider
        label="Brush"
        value={brush.size}
        min={2}
        max={96}
        disabled={disabled}
        before={<Minus size="0.75rem" aria-hidden="true" className="shrink-0 text-[var(--muted-foreground)]" />}
        after={<Plus size="0.75rem" aria-hidden="true" className="shrink-0 text-[var(--muted-foreground)]" />}
        onChange={(size) => onChange({ size })}
      />
      {tool === "clean" && (
        <>
          <EditorSlider
            label="Tolerance"
            value={brush.cleanTolerance}
            min={4}
            max={128}
            tooltip="How closely pixels must match the sampled cleanup color"
            disabled={disabled}
            onChange={(cleanTolerance) => onChange({ cleanTolerance })}
          />
          <EditorSlider
            label="Edge guard"
            value={brush.edgeGuard}
            min={0}
            max={100}
            tooltip="How strongly the brush avoids character-like edge pixels"
            disabled={disabled}
            onChange={(edgeGuard) => onChange({ edgeGuard })}
          />
          <EditorSlider
            label="Feather"
            value={brush.cleanFeather}
            min={0}
            max={100}
            tooltip="Soften the edge of the cleaned brush stroke"
            disabled={disabled}
            onChange={(cleanFeather) => onChange({ cleanFeather })}
          />
        </>
      )}
      {tool === "brush" && (
        <>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-pressed={brush.paintMode === "color"}
              title="Paint with the selected color"
              disabled={disabled}
              onClick={() => onChange({ paintMode: "color" })}
              className={toggleButton(brush.paintMode === "color")}
            >
              Color
            </button>
            <button
              type="button"
              aria-pressed={brush.paintMode === "restore"}
              title="Paint original pixels back in"
              disabled={disabled}
              onClick={() => onChange({ paintMode: "restore" })}
              className={toggleButton(brush.paintMode === "restore")}
            >
              Restore
            </button>
          </div>
          {brush.paintMode === "color" && (
            <div className="flex items-center gap-1.5 text-xs" title="Brush color">
              <label htmlFor={colorId} className="text-[var(--muted-foreground)]">
                Color
              </label>
              <input
                id={colorId}
                type="color"
                aria-label="Brush color"
                value={brush.color}
                disabled={disabled}
                onChange={(event) => onChange({ color: event.target.value })}
                className="h-7 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent disabled:cursor-not-allowed"
              />
              <span className="font-mono tabular-nums text-[var(--foreground)]">{brush.color}</span>
              <button
                type="button"
                aria-pressed={picking}
                title="Pick brush color from the sprite"
                disabled={disabled}
                onClick={onTogglePick}
                className={toggleButton(picking)}
              >
                <Pipette size="0.75rem" aria-hidden="true" />
                Pick
              </button>
            </div>
          )}
        </>
      )}
      {(tool === "erase" || tool === "brush") && (
        <>
          <EditorSlider
            label="Opacity"
            value={brush.opacity}
            min={0}
            max={100}
            tooltip={OPACITY_TOOLTIPS[tooltipKey]}
            disabled={disabled}
            onChange={(opacity) => onChange({ opacity })}
          />
          <EditorSlider
            label="Hardness"
            value={brush.hardness}
            min={0}
            max={100}
            tooltip={HARDNESS_TOOLTIPS[tooltipKey]}
            disabled={disabled}
            onChange={(hardness) => onChange({ hardness })}
          />
        </>
      )}
      {tool === "blur" && (
        <EditorSlider
          label="Strength"
          value={brush.strength}
          min={0}
          max={100}
          tooltip="How strongly the blur brush smooths alpha edges"
          disabled={disabled}
          onChange={(strength) => onChange({ strength })}
        />
      )}
    </>
  );
}
