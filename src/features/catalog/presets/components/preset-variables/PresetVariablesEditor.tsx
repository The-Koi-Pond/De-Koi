import { Hash, Plus } from "lucide-react";
import { useState } from "react";
import { useCardDrag } from "./use-card-drag";
import { VariableCard } from "./VariableCard";
import type { ChoiceBlockRow, PresetVariablesEditorProps } from "./variable-row";

// The Preset Variables list on a preset's Sections tab (docs/provenance/preset-variables.md).

/** The ids with the one at `from` moved to the insert index `insertAt` (counted before the move). */
function movedIds(variables: ChoiceBlockRow[], from: number, insertAt: number): string[] {
  const ids = variables.map((variable) => variable.id);
  const [id] = ids.splice(from, 1);
  ids.splice(insertAt > from ? insertAt - 1 : insertAt, 0, id!);
  return ids;
}

export function PresetVariablesEditor({
  presetId,
  variables,
  onCreateVariable,
  onUpdateVariable,
  onDeleteVariable,
  onReorderVariables,
}: PresetVariablesEditorProps) {
  // Kept by id, so the same card stays expanded after a reorder or a refresh.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const reorder = (variableIds: string[]) => onReorderVariables.mutate({ presetId, variableIds });
  const drag = useCardDrag(variables.length, (from, insertAt) => reorder(movedIds(variables, from, insertAt)));

  const addVariable = () => {
    const now = Date.now();
    onCreateVariable.mutate({
      presetId,
      variableName: `VAR_${now}`,
      question: "Choose an option",
      options: [
        { id: `opt_${now}_a`, label: "Option A", value: "value_a" },
        { id: `opt_${now}_b`, label: "Option B", value: "value_b" },
      ],
    });
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash size="0.875rem" className="text-amber-400" />
          <span className="text-sm font-semibold">Preset Variables</span>
          <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber-400">
            {variables.length}
          </span>
        </div>
        <button
          type="button"
          onClick={addVariable}
          className="flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[0.6875rem] font-medium text-amber-400 transition-colors hover:bg-amber-400/20"
        >
          <Plus size="0.6875rem" /> Add Variable
        </button>
      </div>
      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
        Define variables that users select when assigning this preset to a chat. Use{" "}
        <code className="rounded bg-[var(--secondary)] px-1 font-mono text-amber-400">{"{{variable_name}}"}</code> in
        any section to insert the selected value.
      </p>
      {variables.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-6 text-center">
          <Hash size="1.25rem" className="text-[var(--muted-foreground)]" />
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            No variables yet. Add one to let users customize prompts per chat.
          </p>
        </div>
      ) : (
        <div className="space-y-2" onDragOver={drag.dragOver} onDrop={drag.drop}>
          {variables.map((variable, index) => (
            <VariableCard
              key={variable.id}
              presetId={presetId}
              variable={variable}
              index={index}
              count={variables.length}
              expanded={expandedId === variable.id}
              onToggle={() => setExpandedId((current) => (current === variable.id ? null : variable.id))}
              reorderPending={onReorderVariables.isPending}
              onMove={(delta) => reorder(movedIds(variables, index, delta < 0 ? index - 1 : index + 2))}
              onUpdateVariable={onUpdateVariable}
              onDeleteVariable={onDeleteVariable}
              drag={drag}
            />
          ))}
        </div>
      )}
    </div>
  );
}
