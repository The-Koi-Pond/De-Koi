import { ArrowLeft, FileText, Save, Trash2 } from "lucide-react";
import type { PresetEditorModel } from "./use-preset-editor";

// The header (docs/provenance/preset-overview.md, "Header"): Back, the preset tile, the name, Save, Export, Delete.

/** The upload mark on Export: an arrow up over a base line. */
function ExportIcon() {
  return (
    <svg
      width="0.9375rem"
      height="0.9375rem"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M10 13V3m0 0l-4 4m4-4l4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3" y="15" width="14" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function EditorHeader({ editor }: { editor: PresetEditorModel }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-2 max-md:px-3">
      <button
        type="button"
        aria-label="Back"
        onClick={editor.back}
        className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
      >
        <ArrowLeft size="1.125rem" aria-hidden="true" />
      </button>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 text-white shadow-sm max-md:h-8 max-md:w-8">
        <FileText size="1.125rem" aria-hidden="true" className="max-md:h-3.5 max-md:w-3.5" />
      </div>
      <input
        type="text"
        value={editor.draft.name as string}
        onChange={(event) => editor.edit({ name: event.target.value })}
        onFocus={(event) => event.currentTarget.select()}
        placeholder="Preset name…"
        aria-label="Preset name"
        className="h-10 min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)] max-md:text-base"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void editor.save()}
          disabled={editor.saving}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
        >
          <Save size="0.8125rem" aria-hidden="true" />
          Save
        </button>
        <button
          type="button"
          title="Export preset"
          onClick={() => void editor.exportPreset()}
          className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ExportIcon />
        </button>
        <button
          type="button"
          aria-label="Delete preset"
          onClick={() => void editor.remove()}
          className="rounded-xl p-2 transition-all hover:bg-[var(--destructive)]/15 active:scale-95"
        >
          <Trash2 size="0.9375rem" className="text-[var(--destructive)]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
