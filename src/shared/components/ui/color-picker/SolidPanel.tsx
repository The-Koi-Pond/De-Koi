import { useId } from "react";
import { Pipette } from "lucide-react";
import { cn } from "../../../lib/utils";
import { FALLBACK_PICK_COLOR, SOLID_PRESETS, isGradient, isSixDigitHex } from "./color-value";
import { ColorSwatch, FIELD_CLASS, SectionLabel, presetClass } from "./picker-parts";

interface SolidPanelProps {
  label: string;
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}

/** The native color row, the free text field and the solid presets. */
export function SolidPanel({ label, value, disabled, onPick }: SolidPanelProps) {
  const fieldId = useId();
  const solidValue = isGradient(value) ? "" : value;

  return (
    <>
      <div
        className={cn(
          "relative flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 transition-colors",
          disabled ? "opacity-50" : "focus-within:border-[var(--primary)]/60 hover:border-[var(--primary)]/40",
        )}
      >
        <ColorSwatch value={solidValue || FALLBACK_PICK_COLOR} className="h-6 w-6 rounded-md" />
        <span className="text-xs font-medium text-[var(--foreground)]">Pick color</span>
        <Pipette size="0.75rem" className="ml-auto shrink-0 text-[var(--muted-foreground)]" />
        <input
          type="color"
          aria-label={`Pick ${label} color`}
          value={isSixDigitHex(value) ? value : FALLBACK_PICK_COLOR}
          disabled={disabled}
          onChange={(event) => onPick(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
          Hex / CSS
        </label>
        <input
          id={fieldId}
          type="text"
          aria-label={`${label} hex or CSS color`}
          placeholder="#hex or color name"
          value={solidValue}
          disabled={disabled}
          onChange={(event) => onPick(event.target.value)}
          className={cn(FIELD_CLASS, "px-3 py-2 text-xs")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Presets</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {SOLID_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color} for ${label}`}
              aria-pressed={value === color}
              title={color}
              disabled={disabled}
              onClick={() => onPick(color)}
              style={{ backgroundColor: color }}
              className={cn("h-6 w-6 rounded-md", presetClass(value === color))}
            />
          ))}
        </div>
      </div>
    </>
  );
}
