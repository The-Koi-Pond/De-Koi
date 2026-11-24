import { BookOpen, Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExpandedEditorDialog } from "./ExpandedEditorDialog";
import { MacrosReferenceDialog } from "./MacrosReferenceDialog";
import { insertTabSpaces } from "./tab-key";

/** How long typing waits before saving. */
const SAVE_MS = 800;

const ICON_BUTTON =
  "rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

/** No unsaved text. */
const NONE = Symbol("none");

/**
 * A section's prompt text (docs/provenance/preset-sections.md, "Content editor"). The text follows the stored
 * content except while the text area has focus. Typing saves 800 ms after the last change when the text differs from
 * the stored content as it was at that change; leaving the text area saves at once. Text not saved yet (typed here
 * or in the expanded editor) is saved when the editor goes away: the card collapses, the tab or the preset editor
 * closes (spec follow-up 10).
 */
export function ContentEditor({
  stored,
  name,
  onSave,
}: {
  /** The stored content as stored, not normalised (an empty agent marker shows its macro). */
  stored: unknown;
  /** The section name, for the expanded editor's title. */
  name: unknown;
  onSave: (content: string) => void;
}) {
  const [text, setText] = useState(stored);
  const [expanded, setExpanded] = useState(false);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const focused = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The newest text not saved yet, and the props as of the last render, for the save when the editor goes away.
  const unsaved = useRef<unknown>(NONE);
  const latest = useRef({ stored, onSave });
  latest.current = { stored, onSave };

  useEffect(() => {
    if (!focused.current) setText(stored);
  }, [stored]);

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      const pending = unsaved.current;
      if (pending !== NONE && pending !== latest.current.stored) latest.current.onSave(pending as string);
    },
    [],
  );

  const change = (next: unknown) => {
    setText(next);
    unsaved.current = next;
    clearTimeout(saveTimer.current);
    // Compared with the stored content as it is now, not when the timer fires.
    const storedNow = stored;
    saveTimer.current = setTimeout(() => {
      // Newer text typed in the expanded editor since this change stays unsaved.
      if (unsaved.current === next) unsaved.current = NONE;
      if (next !== storedNow) onSave(next as string);
    }, SAVE_MS);
  };

  const saveNow = () => {
    unsaved.current = NONE;
    if (text !== stored) onSave(text as string);
  };

  return (
    <div className="relative">
      <textarea
        value={text as string}
        onChange={(event) => change(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          clearTimeout(saveTimer.current);
          saveNow();
        }}
        onKeyDown={(event) => insertTabSpaces(event, text, change)}
        placeholder="Prompt content… (supports {{user}}, {{char}}, {{// comment}}, {{trim}} macros)"
        className="min-h-[7.5rem] w-full resize-y rounded-lg bg-[var(--secondary)] p-2.5 pr-8 font-mono text-xs ring-1 placeholder:text-[var(--muted-foreground)] ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
          onDraft={(draft) => {
            unsaved.current = draft;
          }}
          onClose={() => {
            // The closing text was just handed over; its own timer saves it, once (spec follow-up 10: the recorded
            // editor also saved the text of this render, a second save of an earlier hand-over).
            setExpanded(false);
          }}
        />
      )}
      {macrosOpen && <MacrosReferenceDialog onClose={() => setMacrosOpen(false)} />}
    </div>
  );
}
