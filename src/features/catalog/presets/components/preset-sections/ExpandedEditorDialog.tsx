import { useEffect, useRef, useState } from "react";
import { DialogShell } from "./dialog-shell";
import { insertTabSpaces } from "./tab-key";

/** How long typing in the expanded editor waits before handing the text to the content editor. */
const HAND_OVER_MS = 600;

/**
 * The full-screen prompt editor (docs/provenance/preset-sections.md, "Expanded editor"). It saves nothing itself: it
 * hands its text to the content editor 600 ms after the last change, and at once when it closes.
 */
export function ExpandedEditorDialog({
  name,
  value,
  onChange,
  onClose,
}: {
  name: unknown;
  /** The content editor's current text. */
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
}) {
  // Filled once when the dialog opens.
  const [text, setText] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  const handOver = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const focus = setTimeout(() => area.current?.focus(), 100);
    return () => {
      clearTimeout(focus);
      clearTimeout(handOver.current);
    };
  }, []);

  const change = (next: string) => {
    setText(next);
    clearTimeout(handOver.current);
    handOver.current = setTimeout(() => onChange(next), HAND_OVER_MS);
  };

  const close = () => {
    clearTimeout(handOver.current);
    if (text !== value) onChange(text);
    onClose();
  };

  return (
    <DialogShell
      title={name ? `Edit: ${name as string}` : "Edit Prompt"}
      onClose={close}
      panelClassName="h-[80vh] max-w-3xl"
      footer={
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">Changes auto-save. Press Escape to close.</p>
          <button
            type="button"
            onClick={close}
            className="rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-1.5 text-xs font-medium text-white shadow-md"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="flex-1 overflow-hidden p-4">
        <textarea
          ref={area}
          value={text}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => insertTabSpaces(event, change)}
          placeholder="Prompt content… (supports macros like {{user}}, {{char}}, etc.)"
          className="h-full w-full resize-none rounded-lg bg-[var(--secondary)] p-4 font-mono text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
      </div>
    </DialogShell>
  );
}
