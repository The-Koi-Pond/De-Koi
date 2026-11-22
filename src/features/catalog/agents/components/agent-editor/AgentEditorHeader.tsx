import { ArrowLeft, Loader2, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { EditorSaveStatus } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import type { AgentEditorModel } from "./use-agent-editor";

const HEADER_BUTTON =
  "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all active:scale-[0.98]";

export function AgentEditorHeader({ editor }: { editor: AgentEditorModel }) {
  const { form, edit } = editor;
  const storedCustom = editor.custom && !!editor.row;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-x-2 max-md:gap-y-2 max-md:px-3">
      <button
        type="button"
        onClick={editor.back}
        aria-label="Back to agents"
        className="shrink-0 rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
      >
        <ArrowLeft size="1.125rem" aria-hidden="true" />
      </button>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm max-md:h-8 max-md:w-8">
        <Sparkles size="1.125rem" aria-hidden="true" className="max-md:h-4 max-md:w-4" />
      </div>
      <input
        type="text"
        value={form.name}
        onChange={(event) => edit({ name: event.target.value })}
        placeholder="Agent name…"
        aria-label="Agent name"
        className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)] max-md:text-base"
      />
      <div className="flex shrink-0 items-center gap-1.5 max-md:w-full max-md:justify-end max-md:border-t max-md:border-[var(--border)]/30 max-md:pt-2">
        <EditorSaveStatus dirty={editor.dirty} saving={editor.saving} saved={editor.saved} error={editor.saveError} />
        {storedCustom && (
          <>
            <button
              type="button"
              onClick={() => void editor.remove()}
              className={cn(HEADER_BUTTON, "text-[var(--destructive)] hover:bg-[var(--destructive)]/15")}
            >
              <Trash2 size="0.8125rem" aria-hidden="true" /> <span className="max-md:sr-only">Delete</span>
            </button>
            <button
              type="button"
              onClick={() => void editor.exportAgent()}
              disabled={editor.exporting}
              className={cn(
                HEADER_BUTTON,
                "rounded-full bg-[var(--secondary)] px-4 shadow-sm ring-1 ring-[var(--border)] hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-70",
              )}
            >
              {editor.exporting ? (
                <Loader2 size="0.8125rem" className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload size="0.8125rem" aria-hidden="true" />
              )}{" "}
              <span className="max-md:sr-only">Export</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void editor.save()}
          disabled={editor.saving}
          className={cn(
            HEADER_BUTTON,
            "bg-[var(--primary)] px-4 text-[var(--primary-foreground)] shadow-md hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Save size="0.8125rem" aria-hidden="true" /> <span className="max-md:sr-only">Save</span>
        </button>
      </div>
    </div>
  );
}
