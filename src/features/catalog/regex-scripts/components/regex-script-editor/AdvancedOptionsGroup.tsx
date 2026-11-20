import { Info } from "lucide-react";
import { useId } from "react";
import { REGEX_APPLY_MODES } from "../../../../../engine/shared/regex/regex-apply-mode";
import { cn } from "../../../../../shared/lib/utils";
import { REGEX_APPLY_MODE_LABELS, regexApplyModeHelp } from "../../lib/regex-script-editor-state";
import { FIELD_RING, FIELD_SURFACE, FieldGroup, optionTone } from "./FieldGroup";
import { depthFromInput, orderFromInput } from "./regex-script-form";
import type { RegexScriptEditorModel } from "./use-regex-script-editor";

const NUMBER_INPUT = cn(FIELD_SURFACE, FIELD_RING, "rounded-lg px-3 py-1.5 text-xs");
const ROW_LABEL = "w-24 shrink-0 text-xs font-semibold text-[var(--foreground)]";
const NOTE = "text-[0.625rem] text-[var(--muted-foreground)]";

export function AdvancedOptionsGroup({ editor }: { editor: RegexScriptEditorModel }) {
  const { form, edit } = editor;
  const modeLabelId = useId();
  return (
    <FieldGroup icon={Info} label="Advanced Options" help="Fine-tune when and how the regex runs.">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <span id={modeLabelId} className="block text-xs font-medium text-[var(--foreground)]">
            Shows in
          </span>
          <div role="group" aria-labelledby={modeLabelId} className="flex flex-wrap gap-1.5">
            {REGEX_APPLY_MODES.map((mode) => {
              const selected = form.applyMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => edit(() => ({ applyMode: mode }))}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.6875rem] font-medium ring-1 transition-all",
                    optionTone(selected),
                  )}
                >
                  {REGEX_APPLY_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
          <p className={NOTE}>{regexApplyModeHelp(form.applyMode, form.targetCharacterIds.length > 0)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={ROW_LABEL}>Execution Order</span>
          <input
            type="number"
            value={form.order}
            onChange={(event) => {
              const order = orderFromInput(event.target.value);
              edit(() => ({ order }));
            }}
            className={cn(NUMBER_INPUT, "w-20")}
          />
          <span className={NOTE}>Lower numbers run first</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={ROW_LABEL}>Depth Range</span>
          <input
            type="number"
            value={form.minDepth ?? ""}
            onChange={(event) => {
              const minDepth = depthFromInput(event.target.value);
              edit(() => ({ minDepth }));
            }}
            placeholder="Min"
            className={cn(NUMBER_INPUT, "w-16")}
          />
          <span className="text-xs text-[var(--muted-foreground)]">to</span>
          <input
            type="number"
            value={form.maxDepth ?? ""}
            onChange={(event) => {
              const maxDepth = depthFromInput(event.target.value);
              edit(() => ({ maxDepth }));
            }}
            placeholder="Max"
            className={cn(NUMBER_INPUT, "w-16")}
          />
          <span className={NOTE}>message depth (empty = unlimited)</span>
        </div>
      </div>
    </FieldGroup>
  );
}
