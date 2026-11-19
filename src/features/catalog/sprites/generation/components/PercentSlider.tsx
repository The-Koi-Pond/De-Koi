import { useId } from "react";

/** A labelled range whose value shows beside it as "x.x%". The slider's name is the label alone. */
export function PercentSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-[var(--muted-foreground)]">
          {label}
        </label>
        <span aria-hidden="true" className="tabular-nums text-[var(--foreground)]">
          {value.toFixed(1)}%
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={`${value.toFixed(1)}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </div>
  );
}
