import { BookOpen, Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExpandedEditorDialog } from "./ExpandedEditorDialog";
import { MacrosReferenceDialog } from "./MacrosReferenceDialog";
import { insertTabSpaces } from "./tab-key";

/** How long typing waits before saving. */
const SAVE_MS = 800;

const ICON_BUTTON =
  "rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

/**
 * A section's prompt text (docs/provenance/preset-sections.md, "Content editor"). The text follows the stored
 * content except while the text area has focus. Typing saves 800 ms after the last change when the text differs from
 * the stored content as it was at that change; leaving the text area saves at once. A pending save is dropped when
 * the editor goes away (the card collapses or the section is deleted), as recorded.
 */
export function ContentEditor({
  stored,
  name,
  onSave,
}: {
  /** The stored content as shown (an empty agent marker shows its macro). */
  stored: string;
  /** The section name, for the expanded editor's title. */
  name: unknown;
  onSave: (content: string) => void;
}) {
  const [text, setText] = useState(stored);
  const [expanded, setExpanded] = useState(false);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const focused = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!focused.current) setText(stored);
  }, [stored]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const change = (next: string) => {
    setText(next);
    clearTimeout(saveTimer.current);
    // Compared with the stored content as it is now, not when the timer fires.
    const storedNow = stored;
    saveTimer.current = setTimeout(() => {
      if (next !== storedNow) onSave(next);
    }, SAVE_MS);
  };

  const saveNow = () => {
    if (text !== stored) onSave(text);
  };

  return (
    <div className="relative">
      <textarea
        value={text}
        onChange={(event) => change(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          clearTimeout(saveTimer.current);
          saveNow();
        }}
        onKeyDown={(event) => insertTabSpaces(event, change)}
        placeholder="Prompt content… (supports {{user}}, {{char}}, {{// comment}}, {{trim}} macros)"
        className="min-h-[7.5rem] w-full resize-y rounded-lg bg-[var(--secondary)] p-2.5 pr-8 font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      <div className="absolute right-1.5 top-1.5 flex flex-col gap-0.5">
        <button
          type="button"
          title="Expand editor"
          aria-label="Expand editor"
          onClick={() => setExpanded(true)}
          className={ICON_BUTTON}
        >
          <Maximize2 size="0.75rem" />
        </button>
        <button
          type="button"
          title="Macros reference"
          aria-label="Macros reference"
          onClick={() => setMacrosOpen(true)}
          className={ICON_BUTTON}
        >
          <BookOpen size="0.75rem" />
        </button>
      </div>
      {expanded && (
        <ExpandedEditorDialog
          name={name}
          value={text}
          onChange={change}
          onClose={() => {
            setExpanded(false);
            // Saves the text as this render shows it; text handed over just now is saved by its own timer.
            saveNow();
          }}
        />
      )}
      {macrosOpen && <MacrosReferenceDialog onClose={() => setMacrosOpen(false)} />}
    </div>
  );
}
