import { useState, type KeyboardEvent } from "react";
import { cn } from "../../../../../shared/lib/utils";

export const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/60 focus:border-amber-400/50";

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
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400",
        on ? onClass : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
