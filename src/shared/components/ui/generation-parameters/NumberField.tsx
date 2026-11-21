import { useState } from "react";
import { FieldLabel, LINE_FIELD_CLASS } from "./field-parts";

interface NumberFieldProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}

/**
 * Typing edits a draft; leaving the field commits it when it reads as a number in range (even an unchanged one)
 * and otherwise puts the stored number back. Enter leaves the field.
 */
export function NumberField({ label, help, value, min, max, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value));
  // Object.is so a stored NaN counts as unchanged and -0 as a change.
  const [shownValue, setShownValue] = useState(value);
  if (!Object.is(shownValue, value)) {
    setShownValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const next = Number.parseFloat(draft);
    if (next >= min && next <= max) {
      setDraft(String(next));
      onCommit(next);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div>
      <FieldLabel label={label} help={help} />
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={`mt-0.5 ${LINE_FIELD_CLASS}`}
      />
    </div>
  );
}
