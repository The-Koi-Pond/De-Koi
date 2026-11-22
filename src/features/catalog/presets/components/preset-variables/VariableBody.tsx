import { ListChecks, Plus, Shuffle, ToggleRight } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { OptionRows } from "./OptionRows";
import { BlurringTextInput, INPUT, PillSwitch } from "./controls";
import { ValueEditorDialog } from "./ValueEditorDialog";
import type { OptionRow, VariableView } from "./variable-row";

export type VariableUpdate = (data: Record<string, unknown>) => void;

interface VariableBodyProps {
  view: VariableView;
  /** `onUpdateVariable.mutate({ presetId, variableId, ...data })`. */
  update: VariableUpdate;
  editingOption: number | null;
  onEditOption: (index: number | null) => void;
}

const FIELD_LABEL = "mb-1 block text-[0.6875rem] font-medium text-[var(--foreground)]";
const NOTE = "text-[0.625rem] leading-snug text-[var(--muted-foreground)]";
const CODE = "rounded bg-amber-400/10 px-1 font-mono text-amber-400";

/** Letters for new options: `A`, `B`, … and on past `Z` (`[`, `\`, …) as recorded. */
function nextOptionLabel(count: number): string {
  return `Option ${String.fromCharCode(65 + count)}`;
}

export function VariableBody({ view, update, editingOption, onEditOption }: VariableBodyProps) {
  const nameId = useId();
  const questionId = useId();
  const separatorId = useId();
  const { options } = view;
  const saveOptions = (next: OptionRow[]) => update({ options: next });
  const editedOption = editingOption === null ? undefined : options[editingOption];

  const removeOption = (index: number) => {
    if (options.length <= 1) {
      toast.error("A variable needs at least 1 option.");
      return;
    }
    saveOptions(options.filter((_, at) => at !== index));
  };

  const addOption = () =>
    saveOptions([...options, { id: `opt_${Date.now()}`, label: nextOptionLabel(options.length), value: "" }]);

  return (
    <div className="space-y-3 border-t border-amber-400/15 px-3 pb-3 pt-3">
      <div>
        <label htmlFor={nameId} className={FIELD_LABEL}>
          Variable Name
        </label>
        <BlurringTextInput
          id={nameId}
          stored={view.name}
          placeholder="VARIABLE_NAME"
          clean={(text) => text.replace(/[^a-zA-Z0-9_]/g, "")}
          onSave={(variableName) => update({ variableName })}
          className={`${INPUT} font-mono`}
        />
        <p className={`${NOTE} mt-1`}>
          Use <code className={CODE}>{`{{${view.name}}}`}</code> in any prompt section to insert the selected value.
          Must be alphanumeric/underscores only.
        </p>
      </div>
      <div>
        <label htmlFor={questionId} className={FIELD_LABEL}>
          Question (shown to user)
        </label>
        <BlurringTextInput
          id={questionId}
          stored={view.question}
          placeholder="What should the user choose?"
          onSave={(question) => update({ question })}
          className={INPUT}
        />
      </div>
      {view.isBoolean ? (
        <div className="rounded-xl border border-purple-400/20 bg-[var(--secondary)] p-3">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-purple-400">
            <ToggleRight size="0.875rem" />
            Boolean Toggle
          </p>
          <p className={`${NOTE} mt-1`}>
            This variable has only one option, so it behaves as a Boolean toggle. Users can switch it on or off in the
            Configure Preset Variables wizard.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--foreground)]">
                <ListChecks size="0.875rem" className="text-purple-400" />
                Multi-Select
              </span>
              <PillSwitch
                label="Multi-Select"
                on={view.multiSelect}
                onClass="bg-purple-500"
                onToggle={() => update({ multiSelect: !view.multiSelect })}
              />
            </div>
            <p className={`${NOTE} mt-1`}>Allow users to select multiple options instead of just one.</p>
          </div>
          {view.multiSelect && (
            <div className="space-y-2 border-t border-[var(--border)] pt-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--foreground)]">
                  <Shuffle size="0.875rem" className="text-amber-400" />
                  Random Pick
                </span>
                <PillSwitch
                  label="Random Pick"
                  on={view.randomPick}
                  onClass="bg-amber-500"
                  onToggle={() => update({ randomPick: !view.randomPick })}
                />
              </div>
              <p className={NOTE}>
                {view.randomPick
                  ? "One of the user's selected options will be randomly picked each generation."
                  : "All selected options will be joined together with the separator below."}
              </p>
              {!view.randomPick && (
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={separatorId} className="text-[0.6875rem] font-medium text-[var(--foreground)]">
                    Separator
                  </label>
                  <input
                    id={separatorId}
                    type="text"
                    value={view.separator}
                    placeholder=", "
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => update({ separator: event.target.value })}
                    className={`${INPUT} w-20 text-center font-mono`}
                  />
                  <span className={NOTE}>e.g. &quot;, &quot; becomes Romance, Fantasy, Action</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div>
        <p className={FIELD_LABEL}>Options</p>
        <OptionRows options={options} onSave={saveOptions} onRemove={removeOption} onExpand={onEditOption} />
        <button
          type="button"
          onClick={addOption}
          className="mt-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-400/10"
        >
          <Plus size="0.75rem" /> Add Option
        </button>
      </div>
      {editingOption !== null && editedOption && (
        <ValueEditorDialog
          option={editedOption}
          number={editingOption + 1}
          onSave={(value) => saveOptions(options.map((opt, at) => (at === editingOption ? { ...opt, value } : opt)))}
          onClose={() => onEditOption(null)}
        />
      )}
    </div>
  );
}
