import { useId, type ReactNode } from "react";

/**
 * A whole-step slider named by its label alone, with its value shown beside it and read out as `aria-valuetext`.
 * `before` and `after` are decorations either side of the track (not buttons).
 */
export function EditorSlider({
  label,
  value,
  min,
  max,
  tooltip,
  disabled,
  before,
  after,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  tooltip?: string;
  disabled?: boolean;
  before?: ReactNode;
  after?: ReactNode;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-[9rem] flex-1 items-center gap-2 text-xs" title={tooltip}>
      <label htmlFor={id} className="shrink-0 text-[var(--muted-foreground)]">
        {label}
      </label>
      {before}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-valuetext={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-[var(--primary)] disabled:opacity-50"
      />
      {after}
      <span aria-hidden="true" className="w-7 shrink-0 text-right tabular-nums text-[var(--foreground)]">
        {value}
      </span>
    </div>
  );
}
