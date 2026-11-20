import { Info } from "lucide-react";
import { SaveErrorBanner, UnsavedChangesBar } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import { cn } from "../../../../../shared/lib/utils";
import { ExecutionTypeGroup, StaticResultGroup, WebhookUrlGroup } from "./ExecutionGroups";
import { FIELD_SURFACE, FieldGroup, INLINE_CODE, NOTE } from "./FieldGroup";
import { ParametersGroup } from "./ParametersGroup";
import { ToolEditorHeader } from "./ToolEditorHeader";
import { useToolEditor } from "./use-tool-editor";

/** The full-page editor for the custom tool in the UI store's `toolDetailId` (`__new__` for a new one). */
export function ToolEditor() {
  const editor = useToolEditor();
  const { form, edit } = editor;

  if (!editor.found) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Tool not found.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <ToolEditorHeader editor={editor} />
      {editor.leaving && (
        <UnsavedChangesBar
          saving={editor.saving}
          onKeepEditing={editor.keepEditing}
          onDiscard={editor.discard}
          onSaveAndClose={editor.saveAndClose}
        />
      )}
      <SaveErrorBanner error={editor.bannerError} onDismiss={editor.dismissError} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <p className={NOTE}>
            Tool name must be lowercase snake_case (e.g. <code className={INLINE_CODE}>check_weather</code>). This is
            the identifier the AI will use to call this function.
          </p>
          {editor.showScriptWarning && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Script custom tools are disabled in this runtime. Convert this tool to a static result or webhook before
              saving.
            </div>
          )}
          <FieldGroup
            icon={Info}
            label="Description"
            help="Tell the AI what this tool does. Be descriptive — the AI reads this to decide when and how to call your tool."
          >
            <input
              type="text"
              value={form.description}
              onChange={(event) => {
                const description = event.target.value;
                edit(() => ({ description }));
              }}
              placeholder="Describe what this tool does — the AI reads this to decide when to call it…"
              className={cn(FIELD_SURFACE, "w-full rounded-xl px-3 py-2.5 text-sm focus:ring-2")}
            />
          </FieldGroup>
          <ParametersGroup editor={editor} />
          <ExecutionTypeGroup editor={editor} />
          {form.executionType === "static" ? (
            <StaticResultGroup editor={editor} />
          ) : (
            <WebhookUrlGroup editor={editor} />
          )}
        </div>
      </div>
    </div>
  );
}
