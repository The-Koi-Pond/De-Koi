import { useEffect, useState } from "react";

interface DraftNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  selectOnFocus?: boolean;
  /** Accessible name, for inputs without a visible <label>. */
  "aria-label"?: string;
}

export function DraftNumberInput({
  value,
  onCommit,
  className,
  min,
  max,
  integer = true,
  selectOnFocus = false,
  "aria-label": ariaLabel,
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = integer ? parseInt(draft, 10) : parseFloat(draft);
    const inRange =
      !Number.isNaN(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max);

    if (inRange) {
      onCommit(parsed);
      setDraft(String(parsed));
      return;
    }

    setDraft(String(value));
  };

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      onFocus={(e) => {
        if (selectOnFocus) e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
