import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { shownText, type OptionRow } from "./variable-row";

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
  const [text, setText] = useState(() => shownText(option.value));
  const textArea = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const change = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(next), SAVE_DELAY_MS);
  };

  const close = () => {
    clearTimeout(timer.current);
    if (text !== option.value) onSave(text);
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
    change(text.slice(0, start) + TAB_TEXT + text.slice(end));
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = start + TAB_TEXT.length;
    });
  };

  const label = shownText(option.label);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">
            Edit Value: {label || `Option ${number}`}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="min-h-0 flex-1 p-4">
          <textarea
            ref={textArea}
            value={text}
            placeholder="Prompt content… (supports macros like {{user}}, {{char}}, etc.)"
            onChange={(event) => change(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-[60vh] w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/60 focus:border-orange-400/70"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
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
