import { Code, Minus, Plus } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD_SURFACE, FieldGroup, NOTE } from "./FieldGroup";
import { newToolParameter, parameterTypeOptions, type ToolParameter } from "./tool-form";
import type { ToolEditorModel } from "./use-tool-editor";

/** Parameter controls keep a 1px ring on focus. */
const PARAM_CONTROL = cn(FIELD_SURFACE, "rounded-lg px-2.5 py-1.5 text-xs");

export function ParametersGroup({ editor }: { editor: ToolEditorModel }) {
  const { form, edit } = editor;

  const changeRow = (index: number, change: Partial<ToolParameter>) =>
    edit((current) => ({
      parameters: current.parameters.map((parameter, at) => (at === index ? { ...parameter, ...change } : parameter)),
    }));

  return (
    <FieldGroup
      icon={Code}
      label="Parameters"
      help="The input arguments the AI can pass when calling this tool. Each parameter has a name, type, and description."
    >
      <p className={NOTE}>Define the arguments the AI can pass when calling this tool.</p>
      <div className="space-y-2">
        {form.parameters.map((parameter, index) => (
          // Rows have no identity of their own; every control is controlled, so position keys are safe.
          <div
            key={index}
            className="flex items-start gap-2 rounded-xl bg-[var(--card)] p-3 ring-1 ring-[var(--border)]"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={parameter.name}
                  onChange={(event) => changeRow(index, { name: event.target.value })}
                  placeholder="param_name"
                  aria-label="Parameter name"
                  className={cn(PARAM_CONTROL, "w-32 font-mono")}
                />
                <select
                  value={parameter.type}
                  onChange={(event) => changeRow(index, { type: event.target.value })}
                  aria-label="Parameter type"
                  className={PARAM_CONTROL}
                >
                  {parameterTypeOptions(parameter.type).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={parameter.required}
                    onChange={(event) => changeRow(index, { required: event.target.checked })}
                    className="accent-[var(--primary)]"
                  />
                  <span className={NOTE}>Required</span>
                </label>
              </div>
              <input
                type="text"
                value={parameter.description}
                onChange={(event) => changeRow(index, { description: event.target.value })}
                placeholder="Description of this parameter…"
                aria-label="Parameter description"
                className={cn(PARAM_CONTROL, "w-full")}
              />
            </div>
            <button
              type="button"
              onClick={() =>
                edit((current) => ({ parameters: current.parameters.filter((_parameter, at) => at !== index) }))
              }
              aria-label="Remove parameter"
              className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:text-red-400"
            >
              <Minus size="0.75rem" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => edit((current) => ({ parameters: [...current.parameters, newToolParameter()] }))}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
        >
          <Plus size="0.75rem" /> Add Parameter
        </button>
      </div>
    </FieldGroup>
  );
}
