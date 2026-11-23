import { AlertTriangle, X } from "lucide-react";
import type { PresetEditorModel } from "./use-preset-editor";

// The bars under the header (docs/provenance/preset-overview.md, "Bars"), in this order: the saved notice (floating),
// the unsaved-changes bar and the save error bar.

export function EditorBars({ editor }: { editor: PresetEditorModel }) {
  return (
    <>
      {editor.savedVisible && (
        <div
          role="status"
          className="absolute left-1/2 top-14 z-50 -translate-x-1/2 animate-fade-in-up rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 shadow-lg backdrop-blur-sm"
        >
          Changes saved
        </div>
      )}
      {editor.leaving && (
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          {/* Save & close keeps its look while a save runs; only the click is blocked. */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={editor.keepEditing}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={editor.discard}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void editor.saveAndClose()}
              disabled={editor.saving}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}
      {editor.saveError !== null && (
        <div role="alert" className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertTriangle size="0.8125rem" aria-hidden="true" />
          <span className="flex-1">{editor.saveError}</span>
          <button
            type="button"
            aria-label="Dismiss save error"
            onClick={editor.dismissError}
            className="rounded-lg px-2 py-0.5 hover:bg-red-500/20"
          >
            <X size="0.75rem" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
