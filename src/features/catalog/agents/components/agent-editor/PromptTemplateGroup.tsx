import { Check, FileText, RotateCcw } from "lucide-react";
import { useId } from "react";
import { getDefaultAgentPrompt } from "../../../../../engine/contracts/constants/agent-prompts";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD, FieldGroup, NOTE } from "./editor-parts";
import type { AgentEditorModel } from "./use-agent-editor";

const TOOLBAR_BUTTON =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

export function PromptTemplateGroup({ editor }: { editor: AgentEditorModel }) {
  const id = useId();
  const { form, edit, builtIn } = editor;
  const blank = form.promptTemplate.trim() === "";
  const defaultPrompt = builtIn ? getDefaultAgentPrompt(builtIn.id) : "";
  const showDefault = !!builtIn && blank;
  const note = builtIn
    ? "Leave empty to use the built-in default prompt. Edit to override with your own instructions."
    : editor.custom && form.resultType === "text_rewrite"
      ? 'Write the full system prompt for this custom editor. It must return JSON with "editedText" and "changes".'
      : "Write the full system prompt for this custom agent.";
  return (
    <FieldGroup
      icon={FileText}
      label="Prompt Template"
      htmlFor={showDefault ? undefined : id}
      help="The system instructions this agent receives. Built-in agents have sensible defaults. You can override to customize behavior."
    >
      {builtIn && (
        <div className="flex items-center justify-between gap-2">
          {blank ? (
            <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-400">
              <Check size="0.625rem" aria-hidden="true" /> Using built-in default
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-amber-400">
              <FileText size="0.625rem" aria-hidden="true" /> Custom override
            </span>
          )}
          {!blank ? (
            <button type="button" onClick={() => edit({ promptTemplate: "" })} className={TOOLBAR_BUTTON}>
              <RotateCcw size="0.625rem" aria-hidden="true" /> Reset to default
            </button>
          ) : (
            defaultPrompt && (
              <button type="button" onClick={() => edit({ promptTemplate: defaultPrompt })} className={TOOLBAR_BUTTON}>
                <FileText size="0.625rem" aria-hidden="true" /> Copy default to edit
              </button>
            )
          )}
        </div>
      )}
      {showDefault ? (
        <div className="relative">
          <pre className="max-h-[50vh] resize-y overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--secondary)] px-4 py-3 font-mono text-xs leading-relaxed text-[var(--foreground)]/80 ring-1 ring-[var(--border)]">
            {defaultPrompt || "No default prompt."}
          </pre>
          <span className="absolute right-2 top-2 rounded-full bg-[var(--card)] px-2 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
            Default — click &quot;Copy default to edit&quot; to customize
          </span>
        </div>
      ) : (
        <textarea
          id={id}
          rows={16}
          value={form.promptTemplate}
          onChange={(event) => edit({ promptTemplate: event.target.value })}
          placeholder="Write the system prompt for this agent…"
          className={cn(FIELD, "max-h-[60vh] resize-y px-4 py-3 font-mono text-xs leading-relaxed")}
        />
      )}
      <p className={NOTE}>{note}</p>
    </FieldGroup>
  );
}
