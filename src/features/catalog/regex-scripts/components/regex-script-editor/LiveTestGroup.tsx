import { Play } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD_RING, FIELD_SURFACE, FieldGroup } from "./FieldGroup";
import type { RegexScriptEditorModel } from "./use-regex-script-editor";

export function LiveTestGroup({ editor }: { editor: RegexScriptEditorModel }) {
  return (
    <FieldGroup
      icon={Play}
      label="Live Test"
      help="Test your regex pattern against sample text. Macros use sample User and Character values here."
    >
      <textarea
        value={editor.liveText}
        onChange={(event) => editor.setLiveText(event.target.value)}
        rows={3}
        placeholder="Paste sample text to test…"
        className={cn(
          FIELD_SURFACE,
          FIELD_RING,
          "w-full resize-y rounded-xl px-4 py-3 font-mono text-xs leading-relaxed",
        )}
      />
      {editor.liveTestNote && (
        <p role="status" className="text-[0.625rem] text-[var(--muted-foreground)]">
          {editor.liveTestNote}
        </p>
      )}
      {editor.result !== null && (
        <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
          <p className="mb-1 text-[0.625rem] text-[var(--muted-foreground)]">Result:</p>
          <p className="whitespace-pre-wrap break-words font-mono text-xs text-emerald-400">{editor.result}</p>
        </div>
      )}
    </FieldGroup>
  );
}
