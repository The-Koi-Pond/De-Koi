import { useState, type KeyboardEvent } from "react";
import { cn } from "../../../../../shared/lib/utils";

/** The Variable Name and Question inputs. */
export const FIELD_INPUT =
  "w-full rounded bg-[var(--background)] px-2 py-1 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-[var(--ring)]";

/** Enter leaves the field, which saves it. */
export function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

/**
 * The Variable Name and Question inputs: they keep the typed text, show a new stored value whenever it changes
 * (even while focused), and save on blur when the text differs from the stored value.
 */
export function BlurringTextInput({
  id,
  stored,
  placeholder,
  clean = (text) => text,
  onSave,
  className,
}: {
  id: string;
  stored: string;
  placeholder: string;
  /** Applied to every change as it is typed. */
  clean?: (text: string) => string;
  onSave: (text: string) => void;
  className: string;
}) {
  const [text, setText] = useState(stored);
  const [shownStored, setShownStored] = useState(stored);
  if (stored !== shownStored) {
    setShownStored(stored);
    setText(stored);
  }

  return (
    <input
      id={id}
      type="text"
      value={text}
      placeholder={placeholder}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setText(clean(event.target.value))}
      onBlur={() => {
        if (text !== stored) onSave(text);
      }}
      onKeyDown={blurOnEnter}
      className={className}
    />
  );
}

/** A small pill switch (decision 1: a named `switch` with its state). */
export function PillSwitch({
  label,
  on,
  onClass,
  onToggle,
}: {
  label: string;
  on: boolean;
  /** The track color when on. */
  onClass: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative flex h-4 w-7 shrink-0 rounded-full transition-colors",
        on ? onClass : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "h-3 w-3 translate-y-0.5 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
