// The list's props and reading a stored variable row (docs/provenance/preset-variables.md, "Props" and "Reading a
// row"). Rows come from storage as stored, so every field can be missing or odd.
import type {
  useCreateVariable,
  useDeleteVariable,
  useReorderVariables,
  useUpdateVariable,
} from "../../hooks/use-presets";

/** The contract with `PresetEditor.tsx`: the module calls only `mutate(…)` and reads the reorder's `isPending`. */
export interface PresetVariablesEditorProps {
  presetId: string;
  /** The preset's variables in stored order. */
  variables: ChoiceBlockRow[];
  onCreateVariable: Pick<ReturnType<typeof useCreateVariable>, "mutate">;
  onUpdateVariable: Pick<ReturnType<typeof useUpdateVariable>, "mutate">;
  onDeleteVariable: Pick<ReturnType<typeof useDeleteVariable>, "mutate">;
  onReorderVariables: Pick<ReturnType<typeof useReorderVariables>, "mutate" | "isPending">;
}

/** A preset variable (choice block) as storage holds it. */
export interface ChoiceBlockRow {
  id: string;
  presetId?: unknown;
  variableName?: unknown;
  /** Older rows store the name here. */
  variable_name?: unknown;
  question?: unknown;
  options?: unknown;
  multiSelect?: unknown;
  randomPick?: unknown;
  separator?: unknown;
  visibilityRule?: unknown;
}

/** One stored option, every key kept as stored (saves send them all back). */
export type OptionRow = Record<string, unknown> & { id?: unknown; label?: unknown; value?: unknown };

export interface VariableView {
  /** As stored (a number or other non-text value stays as it is; inputs compare against it strictly). */
  name: unknown;
  question: unknown;
  options: OptionRow[];
  multiSelect: boolean;
  randomPick: boolean;
  separator: string;
  /** Exactly one option and Multi-Select off: users switch it on or off. */
  isBoolean: boolean;
}

/** On only for `true` or the string `"true"`. */
function isOn(value: unknown): boolean {
  return value === true || value === "true";
}

export function readVariable(row: ChoiceBlockRow): VariableView {
  const options = Array.isArray(row.options) ? (row.options as OptionRow[]) : [];
  const multiSelect = isOn(row.multiSelect);
  return {
    name: row.variableName ?? row.variable_name ?? "",
    question: row.question ?? "",
    options,
    multiSelect,
    randomPick: isOn(row.randomPick),
    separator: String(row.separator ?? ", "),
    isBoolean: options.length === 1 && !multiSelect,
  };
}

/** What an input shows for a stored value: the value as React would show it, nothing for missing or `null`. */
export function inputValue(value: unknown): string {
  return (value ?? "") as string;
}

/**
 * Empty or only spaces. A missing value counts as blank; a stored value that isn't text (a number) throws, which
 * takes the whole list down as recorded (follow-up 6 changes that).
 */
export function isBlankValue(opt: OptionRow): boolean {
  return !opt.value || !(opt.value as string).trim();
}

/** The name shown in control names, `variable` when the variable has none. */
export function nameForLabels(name: unknown): string {
  return `${name || "variable"}`;
}
