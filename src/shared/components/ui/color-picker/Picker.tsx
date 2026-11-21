import { useId, useState, type ReactNode } from "react";
import { Pipette, Sparkles, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  DEFAULT_ANGLE,
  DEFAULT_STOPS,
  buildGradient,
  isGradient,
  readGradientAngle,
  readGradientStops,
} from "./color-value";
import { GradientPanel } from "./GradientPanel";
import { ColorSwatch } from "./picker-parts";
import { SolidPanel } from "./SolidPanel";

export interface ColorPickerProps {
  /** "" means no color is set. */
  value: string;
  onChange: (value: string) => void;
  /** Allow switching to a linear gradient. */
  gradient?: boolean;
  /** Tighter spacing for narrow drawers. */
  compact?: boolean;
  label: string;
  helpText?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Shown right after the label. */
  headerAction?: ReactNode;
}

type Mode = "solid" | "gradient";

export function ColorPicker({
  value,
  onChange,
  gradient = false,
  compact = false,
  label,
  helpText,
  emptyText = "No color set — uses default",
  disabled = false,
  headerAction,
}: ColorPickerProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (isGradient(value) ? "gradient" : "solid"));
  const [stops, setStops] = useState<readonly string[]>(() =>
    isGradient(value) ? readGradientStops(value) : DEFAULT_STOPS,
  );
  const [angle, setAngle] = useState(() => (isGradient(value) ? readGradientAngle(value) : null) ?? DEFAULT_ANGLE);

  // Follow a new value from the caller during render, so the panel never shows a stale mode for a frame.
  // An emptied value keeps the mode and stops the picker had.
  const [followedValue, setFollowedValue] = useState(value);
  if (value !== followedValue) {
    setFollowedValue(value);
    if (isGradient(value)) {
      setMode("gradient");
      setStops(readGradientStops(value));
      const nextAngle = readGradientAngle(value);
      if (nextAngle !== null) setAngle(nextAngle);
    } else if (value !== "") {
      setMode("solid");
    }
  }

  const hand = (next: string) => {
    if (!disabled) onChange(next);
  };

  const chooseMode = (next: Mode) => {
    // Decision 3: the mode that is already selected hands nothing over.
    if (disabled || next === mode) return;
    setMode(next);
    if (next === "gradient") hand(buildGradient(stops, angle));
    // An emptied first stop switches to solid without handing over "" (which would clear the color).
    else if (stops[0]) hand(stops[0]);
  };

  const editStops = (next: string[]) => {
    if (disabled) return;
    setStops(next);
    hand(buildGradient(next, angle));
  };

  const editAngle = (next: number) => {
    if (disabled) return;
    setAngle(next);
    hand(buildGradient(stops, next));
  };

  const applyPreset = (preset: string) => {
    if (disabled) return;
    setStops(readGradientStops(preset));
    setAngle(readGradientAngle(preset) ?? angle);
    hand(preset);
  };

  const clear = () => {
    if (disabled) return;
    hand("");
    setOpen(false);
  };

  return (
    <div className={cn("flex min-w-0 flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
          {headerAction}
        </div>
        {value !== "" && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            disabled={disabled}
            onClick={clear}
            className="flex shrink-0 items-center gap-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors enabled:hover:text-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size="0.625rem" />
            Clear
          </button>
        )}
      </div>

      {helpText && <p className="text-[0.625rem] text-[var(--muted-foreground)]/70">{helpText}</p>}

      <button
        type="button"
        aria-label={`${label}: ${value || emptyText}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(
          "flex w-full min-w-0 items-center border bg-[var(--secondary)] text-left transition-[border-color,box-shadow]",
          compact ? "gap-2 rounded-lg p-1.5" : "gap-3 rounded-xl p-2.5",
          open
            ? "border-[var(--primary)]/50 ring-2 ring-[var(--primary)]/15"
            : "border-[var(--border)] enabled:hover:border-[var(--primary)]/30",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <ColorSwatch value={value} className={compact ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg"} />
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{value || emptyText}</span>
        <Pipette size="0.8125rem" className="shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div
          id={panelId}
          className={cn(
            "flex min-w-0 animate-fade-in-down flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]",
            compact ? "gap-2 p-2" : "gap-3 p-3",
          )}
        >
          {gradient && (
            <div className="flex gap-0.5 rounded-lg bg-[var(--secondary)] p-0.5">
              <ModeButton selected={mode === "solid"} disabled={disabled} onClick={() => chooseMode("solid")}>
                <Pipette size="0.6875rem" />
                Solid
              </ModeButton>
              <ModeButton selected={mode === "gradient"} disabled={disabled} onClick={() => chooseMode("gradient")}>
                <Sparkles size="0.6875rem" />
                Gradient
              </ModeButton>
            </div>
          )}
          {mode === "solid" ? (
            <SolidPanel label={label} value={value} disabled={disabled} onPick={hand} />
          ) : (
            <GradientPanel
              label={label}
              value={value}
              stops={stops}
              angle={angle}
              disabled={disabled}
              onStops={editStops}
              onAngle={editAngle}
              onPreset={applyPreset}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.6875rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
          : "text-[var(--muted-foreground)] enabled:hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}
