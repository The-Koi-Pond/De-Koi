import { Eye, Loader2, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

import { editorButton, errorText, mutedText, primaryEditorButton } from "./editor-styles";

/** The footer: status (or error) line, pixel readout, then the history and save buttons. */
export function CleanupFooter({
  status,
  error,
  readout,
  canUndo,
  canRedo,
  hasChanges,
  busy,
  historyLocked,
  applying,
  onUndo,
  onRedo,
  onReset,
  onShowOriginal,
  onCancel,
  onApply,
}: {
  status: string;
  error: string | null;
  readout: string;
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;
  /** Loading or saving. */
  busy: boolean;
  /** Busy, or a stroke or pan is in progress. */
  historyLocked: boolean;
  applying: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onShowOriginal: (showing: boolean) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const hold = (showing: boolean) => () => onShowOriginal(showing);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p role="alert" className={`${errorText} empty:hidden`}>
          {error}
        </p>
        <p role="status" aria-live="polite" className="text-xs text-[var(--foreground)] empty:hidden">
          {error ? null : status}
        </p>
        <p className={`${mutedText} tabular-nums`}>{readout}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title="Undo (Ctrl/Cmd+Z)"
          disabled={historyLocked || !canUndo}
          onClick={onUndo}
          className={editorButton}
        >
          <Undo2 size="0.875rem" aria-hidden="true" />
          Undo
        </button>
        <button
          type="button"
          title="Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)"
          disabled={historyLocked || !canRedo}
          onClick={onRedo}
          className={editorButton}
        >
          <Redo2 size="0.875rem" aria-hidden="true" />
          Redo
        </button>
        <button type="button" disabled={historyLocked || !hasChanges} onClick={onReset} className={editorButton}>
          <RotateCcw size="0.875rem" aria-hidden="true" />
          Reset
        </button>
        <button
          type="button"
          title="Hold to see the sprite as it was"
          disabled={busy || !hasChanges}
          onPointerDown={hold(true)}
          onPointerUp={hold(false)}
          onPointerLeave={hold(false)}
          onPointerCancel={hold(false)}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") onShowOriginal(true);
          }}
          onKeyUp={hold(false)}
          onBlur={hold(false)}
          className={editorButton}
        >
          <Eye size="0.875rem" aria-hidden="true" />
          Show original
        </button>
        <button type="button" disabled={applying} onClick={onCancel} className={editorButton}>
          Cancel
        </button>
        <button type="button" disabled={busy || !hasChanges} onClick={onApply} className={primaryEditorButton}>
          {applying ? (
            <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size="0.875rem" aria-hidden="true" />
          )}
          {applying ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
