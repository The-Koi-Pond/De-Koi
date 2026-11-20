import { ArrowLeft, Regex, Save, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { EditorSaveStatus } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import type { RegexScriptEditorModel } from "./use-regex-script-editor";

export function EditorHeader({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <button
        type="button"
        onClick={editor.back}
        aria-label="Back to regex scripts"
        className="shrink-0 rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
      >
        <ArrowLeft size="1.125rem" />
      </button>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-sm">
        <Regex size="1.25rem" aria-hidden="true" />
      </div>
      <input
        type="text"
        value={form.name}
        onChange={(event) => {
          const name = event.target.value;
          edit(() => ({ name }));
        }}
        placeholder="Script name…"
        className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)]"
      />
      <EditorSaveStatus dirty={editor.dirty} saving={editor.saving} saved={editor.saved} error={editor.saveError} />
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Enabled"
          title={form.enabled ? "Enabled" : "Disabled"}
          onClick={() => edit((current) => ({ enabled: !current.enabled }))}
          className="rounded-xl p-2 text-xs transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          {form.enabled ? (
            <ToggleRight size="1.25rem" className="text-emerald-400" />
          ) : (
            <ToggleLeft size="1.25rem" className="text-[var(--muted-foreground)]" />
          )}
        </button>
        {editor.scriptId && (
          <button
            type="button"
            onClick={() => void editor.remove()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/15 active:scale-[0.98]"
          >
            <Trash2 size="0.8125rem" /> Delete
          </button>
        )}
        <button
          type="button"
          onClick={() => void editor.save()}
          disabled={editor.saving || editor.patternError !== null}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-400 to-red-500 px-4 py-2 text-xs font-semibold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size="0.8125rem" /> Save
        </button>
      </div>
    </div>
  );
}
