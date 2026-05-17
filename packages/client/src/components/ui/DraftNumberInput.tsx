import { useEffect, useState } from "react";

interface DraftNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  selectOnFocus?: boolean;
  commitOnValidChange?: boolean;
}

export function DraftNumberInput({
  value,
  onCommit,
  className,
  min,
  max,
  integer = true,
  selectOnFocus = false,
  commitOnValidChange = false,
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const parseDraft = (raw: string) => {
    const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
    const inRange =
      !Number.isNaN(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max);

    return inRange ? parsed : null;
  };

  const commit = () => {
    const parsed = parseDraft(draft);

    if (parsed !== null) {
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
      onChange={(e) => {
        const nextDraft = e.target.value;
        setDraft(nextDraft);
        if (commitOnValidChange) {
          const parsed = parseDraft(nextDraft);
          if (parsed !== null) onCommit(parsed);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
