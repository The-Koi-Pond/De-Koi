import { ArrowLeft, Save, Trash2, Wrench } from "lucide-react";
import { EditorSaveStatus } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import type { ToolEditorModel } from "./use-tool-editor";

export function ToolEditorHeader({ editor }: { editor: ToolEditorModel }) {
  const { form, edit } = editor;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <button
        type="button"
        onClick={editor.back}
        aria-label="Back to tools"
        className="shrink-0 rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
      >
        <ArrowLeft size="1.125rem" />
      </button>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
        <Wrench size="1.125rem" aria-hidden="true" />
      </div>
      <input
        type="text"
        value={form.name}
        onChange={(event) => {
          const name = event.target.value;
          edit(() => ({ name }));
        }}
        placeholder="tool_name"
        aria-label="Tool name"
        className="min-w-0 flex-1 bg-transparent font-mono text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)]"
      />
      <EditorSaveStatus dirty={editor.dirty} saving={editor.saving} saved={editor.saved} error={editor.saveError} />
      <div className="flex shrink-0 items-center gap-1.5">
        {editor.isStored && (
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
          disabled={editor.saving}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size="0.8125rem" /> Save
        </button>
      </div>
    </div>
  );
}
