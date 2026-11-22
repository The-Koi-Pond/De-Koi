import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { inputValue, type OptionRow } from "./variable-row";

const SAVE_DELAY_MS = 600;
const FOCUS_DELAY_MS = 100;
const TAB_TEXT = "  ";

/**
 * The full-screen value editor for one option. It opens with the option's value (later stored changes don't replace
 * it), saves 600 ms after the last change, and on closing (X, Done, the backdrop, Escape anywhere) cancels a pending
 * save and saves at once when the text differs from the option's value.
 */
export function ValueEditorDialog({
  option,
  number,
  onSave,
  onClose,
}: {
  option: OptionRow;
  /** The option's 1-based place, for the title when it has no label. */
  number: number;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  // Starts as the stored value as it is (missing, `null` or a number included); closing compares against it strictly.
  const [text, setText] = useState<unknown>(option.value);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const change = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(next), SAVE_DELAY_MS);
  };

  const close = () => {
    clearTimeout(timer.current);
    if (text !== option.value) onSave(text as string);
    onClose();
  };

  // Escape closes from anywhere on the page; the listener always runs the latest close.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const focusTimer = setTimeout(() => textArea.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(focusTimer);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Tab inserts two spaces at the cursor (replacing a selection) instead of moving focus.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const area = event.currentTarget;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // Works on the text as it is: a stored value that isn't text throws here, as it did before (follow-up).
    const current = text as string;
    change(current.substring(0, start) + TAB_TEXT + current.substring(end));
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = start + TAB_TEXT.length;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold">
            {`Edit Value: ${option.label ? option.label : `Option ${number}`}`}
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="rounded-lg p-1.5 hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            ref={textArea}
            value={inputValue(text)}
            placeholder="Prompt content… (supports macros like {{user}}, {{char}}, etc.)"
            onChange={(event) => change(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-full w-full resize-none rounded-lg bg-[var(--secondary)] p-4 font-mono text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">Changes auto-save. Press Escape to close.</p>
          <button
            type="button"
            onClick={close}
            className="rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-1.5 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
