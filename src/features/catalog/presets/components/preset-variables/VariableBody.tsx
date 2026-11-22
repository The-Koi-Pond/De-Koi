import { ListChecks, Plus, Shuffle, ToggleLeft } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { OptionRows } from "./OptionRows";
import { BlurringTextInput, FIELD_INPUT, PillSwitch } from "./controls";
import { ValueEditorDialog } from "./ValueEditorDialog";
import type { OptionRow, VariableView } from "./variable-row";

type VariableUpdate = (data: Record<string, unknown>) => void;

interface VariableBodyProps {
  view: VariableView;
  /** `onUpdateVariable.mutate({ presetId, variableId, ...data })`. */
  update: VariableUpdate;
  editingOption: number | null;
  onEditOption: (index: number | null) => void;
}

const FIELD_LABEL = "mb-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]";
const NOTE = "text-[0.5625rem] text-[var(--muted-foreground)]";
const PANEL = "rounded-lg bg-[var(--secondary)] p-2.5 ring-1 ring-[var(--border)]";
const SWITCH_LABEL = "flex items-center gap-1.5";

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
    <div className="space-y-3 border-t border-amber-400/20 p-3">
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
          className={`${FIELD_INPUT} mb-1 font-mono`}
        />
        <p className={NOTE}>
          Use <code className="font-mono text-amber-400">{`{{${view.name}}}`}</code> in any prompt section to insert the
          selected value. Must be alphanumeric/underscores only.
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
          className={FIELD_INPUT}
        />
      </div>
      {view.isBoolean ? (
        <div className={PANEL}>
          <div className={`${SWITCH_LABEL} mb-1.5`}>
            <ToggleLeft size="0.75rem" className="text-purple-400" />
            <span className="text-[0.625rem] font-medium text-purple-400">Boolean Toggle</span>
          </div>
          <p className={NOTE}>
            This variable has only one option, so it behaves as a Boolean toggle. Users can switch it on or off in the
            Configure Preset Variables wizard.
          </p>
        </div>
      ) : (
        <div className={`${PANEL} space-y-2`}>
          <div className="flex items-center justify-between">
            <div className={SWITCH_LABEL}>
              <ListChecks size="0.75rem" className="text-purple-400" />
              <span className="text-[0.625rem] font-medium">Multi-Select</span>
            </div>
            <PillSwitch
              label="Multi-Select"
              on={view.multiSelect}
              onClass="bg-purple-400"
              onToggle={() => update({ multiSelect: !view.multiSelect })}
            />
          </div>
          <p className={NOTE}>Allow users to select multiple options instead of just one.</p>
          {view.multiSelect && (
            <div className="space-y-2 border-t border-[var(--border)] pt-2">
              <div className="flex items-center justify-between">
                <div className={SWITCH_LABEL}>
                  <Shuffle size="0.75rem" className="text-amber-400" />
                  <span className="text-[0.625rem] font-medium">Random Pick</span>
                </div>
                <PillSwitch
                  label="Random Pick"
                  on={view.randomPick}
                  onClass="bg-amber-400"
                  onToggle={() => update({ randomPick: !view.randomPick })}
                />
              </div>
              <p className={NOTE}>
                {view.randomPick
                  ? "One of the user's selected options will be randomly picked each generation."
                  : "All selected options will be joined together with the separator below."}
              </p>
              {!view.randomPick && (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={separatorId}
                    className="shrink-0 text-[0.625rem] font-medium text-[var(--muted-foreground)]"
                  >
                    Separator
                  </label>
                  <input
                    id={separatorId}
                    type="text"
                    value={view.separator}
                    placeholder=", "
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => update({ separator: event.target.value })}
                    className="w-20 rounded bg-[var(--background)] px-1.5 py-0.5 text-center font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-[var(--ring)]"
                  />
                  <span className={NOTE}>e.g. &quot;, &quot; becomes Romance, Fantasy, Action</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <label className={FIELD_LABEL}>Options</label>
        <OptionRows options={options} onSave={saveOptions} onRemove={removeOption} onExpand={onEditOption} />
        <button
          type="button"
          onClick={addOption}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium text-amber-400 transition-colors hover:bg-amber-400/10"
        >
          <Plus size="0.625rem" /> Add Option
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
