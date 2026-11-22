import { Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../../../shared/lib/utils";
import { INPUT, blurOnEnter } from "./controls";
import { isBlankValue, shownText, type OptionRow } from "./variable-row";

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
  stored: string;
  placeholder: string;
  name: string;
  invalid?: boolean;
  mono?: boolean;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(stored);
  const [shownStored, setShownStored] = useState(stored);
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
      value={text}
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
        if (text !== stored) onSave(text);
      }}
      onKeyDown={blurOnEnter}
      className={cn(
        INPUT,
        "min-w-0 flex-1 py-1",
        mono && "font-mono",
        invalid && "border-red-500/50 bg-red-500/10 placeholder:text-red-400/60",
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

  return (
    <div className="space-y-1.5">
      {options.map((opt, index) => {
        const blank = isBlankValue(opt);
        const number = index + 1;
        return (
          <div key={(opt.id as string | undefined) ?? index}>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                blank ? "border-red-500/40 bg-red-500/5" : "border-[var(--border)] bg-[var(--secondary)]",
              )}
            >
              <span className="w-5 shrink-0 text-[0.6875rem] font-semibold text-amber-400">{number}.</span>
              <OptionTextInput
                stored={shownText(opt.label)}
                placeholder="Label…"
                name={`Option ${number} label`}
                onSave={(text) => saveField(index, "label", text)}
              />
              <OptionTextInput
                stored={shownText(opt.value)}
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
                className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                <Maximize2 size="0.75rem" />
              </button>
              <button
                type="button"
                title="Remove option"
                aria-label={`Remove option ${number}`}
                onClick={() => onRemove(index)}
                className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-red-400"
              >
                <X size="0.75rem" />
              </button>
            </div>
            {blank && <p className="mt-0.5 pl-7 text-[0.625rem] text-red-400">Value cannot be empty.</p>}
          </div>
        );
      })}
    </div>
  );
}
