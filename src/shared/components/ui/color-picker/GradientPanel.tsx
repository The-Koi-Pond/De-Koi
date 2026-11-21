import { Plus, Trash2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { GRADIENT_PRESETS, NEW_STOP, buildGradient } from "./color-value";
import { FIELD_CLASS, SectionLabel, presetClass } from "./picker-parts";

interface GradientPanelProps {
  label: string;
  value: string;
  stops: readonly string[];
  angle: number;
  disabled: boolean;
  onStops: (stops: string[]) => void;
  onAngle: (angle: number) => void;
  onPreset: (preset: string) => void;
}

/** The gradient editor: preview, stops, angle and the gradient presets. */
export function GradientPanel({
  label,
  value,
  stops,
  angle,
  disabled,
  onStops,
  onAngle,
  onPreset,
}: GradientPanelProps) {
  const replaceStop = (index: number, stop: string) => onStops(stops.map((old, at) => (at === index ? stop : old)));

  return (
    <>
      <div
        data-gradient-preview
        className="h-8 w-full rounded-lg border border-[var(--border)]"
        style={{ background: buildGradient(stops, angle) }}
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Color Stops</SectionLabel>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onStops([...stops, NEW_STOP])}
            className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors enabled:hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size="0.625rem" />
            Add
          </button>
        </div>
        {stops.map((stop, index) => {
          const n = index + 1;
          return (
            <div key={index} className="flex min-w-0 items-center gap-2">
              <input
                type="color"
                aria-label={`${label} gradient stop ${n} color`}
                value={stop}
                disabled={disabled}
                onChange={(event) => replaceStop(index, event.target.value)}
                className="h-7 w-7 shrink-0 cursor-pointer rounded-sm border border-[var(--border)] bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
              />
              <input
                type="text"
                aria-label={`${label} gradient stop ${n} CSS color`}
                value={stop}
                disabled={disabled}
                onChange={(event) => replaceStop(index, event.target.value)}
                className={cn(FIELD_CLASS, "px-2.5 py-1.5 text-[0.6875rem]")}
              />
              {stops.length >= 3 && (
                <button
                  type="button"
                  aria-label={`Remove ${label} gradient stop ${n}`}
                  disabled={disabled}
                  onClick={() => onStops(stops.filter((_, at) => at !== index))}
                  className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors enabled:hover:text-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size="0.6875rem" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Angle</SectionLabel>
          <span className="min-w-11 text-right font-mono text-[0.625rem] tabular-nums text-[var(--muted-foreground)]">
            {angle}°
          </span>
        </div>
        <input
          type="range"
          aria-label="Gradient angle"
          min={0}
          max={360}
          step={1}
          value={angle}
          disabled={disabled}
          onChange={(event) => onAngle(Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Presets</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {GRADIENT_PRESETS.map((preset, index) => (
            <button
              key={preset}
              type="button"
              aria-label={`Use gradient preset ${index + 1} for ${label}`}
              aria-pressed={value === preset}
              disabled={disabled}
              onClick={() => onPreset(preset)}
              style={{ background: preset }}
              className={cn("h-6 rounded-md", presetClass(value === preset))}
            />
          ))}
        </div>
      </div>
    </>
  );
}
