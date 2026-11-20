import { FileText, Globe, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD_SURFACE, FieldGroup, INLINE_CODE, NOTE } from "./FieldGroup";
import type { ExecutionType } from "./tool-form";
import type { ToolEditorModel } from "./use-tool-editor";

const EXECUTION_TYPES: ReadonlyArray<{ type: ExecutionType; label: string; icon: LucideIcon; note: string }> = [
  { type: "static", label: "Static Result", icon: FileText, note: "Returns a fixed string when called." },
  { type: "webhook", label: "Webhook", icon: Globe, note: "Sends a POST request to an external URL." },
];

export function ExecutionTypeGroup({ editor }: { editor: ToolEditorModel }) {
  const { form, edit } = editor;
  const selected = EXECUTION_TYPES.find((option) => option.type === form.executionType)!;
  return (
    <FieldGroup icon={Wrench} label="Execution Type">
      <div className="grid grid-cols-2 gap-3">
        {EXECUTION_TYPES.map(({ type, label, icon: Icon, note }) => {
          const active = type === form.executionType;
          return (
            <button
              key={type}
              type="button"
              title={note}
              aria-pressed={active}
              onClick={() => edit(() => ({ executionType: type }))}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl px-4 py-3 text-xs font-medium ring-1 transition-all",
                active
                  ? "bg-[var(--primary)]/10 text-[var(--primary)] ring-[var(--primary)]"
                  : "text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon size="1rem" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className={NOTE}>{selected.note}</p>
    </FieldGroup>
  );
}

export function StaticResultGroup({ editor }: { editor: ToolEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup icon={FileText} label="Static Result">
      <textarea
        value={form.staticResult}
        onChange={(event) => {
          const staticResult = event.target.value;
          edit(() => ({ staticResult }));
        }}
        rows={5}
        placeholder={'{"result": "OK"}'}
        className={cn(FIELD_SURFACE, "w-full resize-y rounded-xl px-4 py-3 font-mono text-xs focus:ring-2")}
      />
      <p className={NOTE}>
        This string is returned as-is when the AI calls this tool. Useful for informational tools or placeholders.
      </p>
    </FieldGroup>
  );
}

export function WebhookUrlGroup({ editor }: { editor: ToolEditorModel }) {
  const { form, edit } = editor;
  return (
    <FieldGroup icon={Globe} label="Webhook URL">
      <input
        type="text"
        value={form.webhookUrl}
        onChange={(event) => {
          const webhookUrl = event.target.value;
          edit(() => ({ webhookUrl }));
        }}
        placeholder="https://api.example.com/my-tool"
        className={cn(FIELD_SURFACE, "w-full rounded-xl px-4 py-2.5 font-mono text-sm focus:ring-2")}
      />
      <p className={NOTE}>
        A POST request will be sent with <code className={INLINE_CODE}>{"{ tool, arguments }"}</code> as JSON body.
        Response is returned to the AI.
      </p>
    </FieldGroup>
  );
}
