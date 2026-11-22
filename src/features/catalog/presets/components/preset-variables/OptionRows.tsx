import { Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../../../shared/lib/utils";
import { blurOnEnter } from "./controls";
import { inputValue, isBlankValue, type OptionRow } from "./variable-row";

const SAVE_DELAY_MS = 600;

/**
 * An option's label or value input. Typing saves 600 ms after the last keystroke; blur cancels that and saves at
 * once when the text differs from the stored one. While focused, a new stored value doesn't replace the typed text.
 * Unmounting (the card collapsing) drops a pending save.
 */
function OptionTextInput({
  stored,
  placeholder,
  name,
  invalid = false,
  mono = false,
  onSave,
}: {
  /** The stored label or value as it is; the typed text is compared against it strictly. */
  stored: unknown;
  placeholder: string;
  name: string;
  invalid?: boolean;
  mono?: boolean;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState<unknown>(stored);
  const [shownStored, setShownStored] = useState<unknown>(stored);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (stored !== shownStored) {
    setShownStored(stored);
    if (!focused) setText(stored);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="text"
      value={inputValue(text)}
      placeholder={placeholder}
      aria-label={name}
      onFocus={(event) => {
        setFocused(true);
        event.target.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onSave(next), SAVE_DELAY_MS);
      }}
      onBlur={() => {
        setFocused(false);
        clearTimeout(timer.current);
        if (text !== stored) onSave(text as string);
      }}
      onKeyDown={blurOnEnter}
      className={cn(
        "flex-1 rounded bg-[var(--background)] px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--ring)]",
        mono && "font-mono",
        invalid &&
          "bg-[var(--destructive)]/10 ring-1 ring-[var(--destructive)]/30 placeholder:text-[var(--destructive)]/40",
      )}
    />
  );
}

/** The option rows: number, label and value inputs, the value editor and remove buttons. */
export function OptionRows({
  options,
  onSave,
  onRemove,
  onExpand,
}: {
  options: OptionRow[];
  /** Saves the whole option list. */
  onSave: (options: OptionRow[]) => void;
  onRemove: (index: number) => void;
  onExpand: (index: number) => void;
}) {
  // Each save sends the list as this render has it, with that one field changed.
  const saveField = (index: number, field: "label" | "value", text: string) =>
    onSave(options.map((opt, at) => (at === index ? { ...opt, [field]: text } : opt)));

  return options.map((opt, index) => {
    const blank = isBlankValue(opt);
    const number = index + 1;
    return (
      <div key={opt.id as string | undefined}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1",
            blank
              ? "bg-[var(--destructive)]/5 ring-[var(--destructive)]/30"
              : "bg-[var(--secondary)] ring-[var(--border)]",
          )}
        >
          <span className="shrink-0 text-[0.625rem] font-medium text-amber-400">{number}.</span>
          <OptionTextInput
            stored={opt.label}
            placeholder="Label…"
            name={`Option ${number} label`}
            onSave={(text) => saveField(index, "label", text)}
          />
          <OptionTextInput
            stored={opt.value}
            placeholder="Value…"
            name={`Option ${number} value`}
            invalid={blank}
            mono
            onSave={(text) => saveField(index, "value", text)}
          />
          <button
            type="button"
            title="Expand value editor"
            aria-label={`Edit value of option ${number}`}
            onClick={() => onExpand(index)}
            className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <Maximize2 size="0.625rem" />
          </button>
          <button
            type="button"
            title="Remove option"
            aria-label={`Remove option ${number}`}
            onClick={() => onRemove(index)}
            className="shrink-0 rounded p-0.5 hover:bg-[var(--destructive)]/10"
          >
            <X size="0.625rem" className="text-[var(--destructive)]" />
          </button>
        </div>
        {blank && <p className="mt-1 pl-6 text-[0.5625rem] text-[var(--destructive)]">Value cannot be empty.</p>}
      </div>
    );
  });
}
