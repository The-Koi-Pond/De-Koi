import type { ChoiceOption, ChoiceVisibilityRule } from "../../../../engine/contracts/types/prompt";
import type { ChoiceSelections } from "./choice-selections";

export type { ChoiceVisibilityRule };

export function choiceOptionDisplayText(option: ChoiceOption): string {
  return option.description?.trim() || option.value;
}

export function choiceVariableVisible(
  visibilityRule: ChoiceVisibilityRule | null | undefined,
  selections: ChoiceSelections,
): boolean {
  if (!visibilityRule) return true;
  const selected = selections[visibilityRule.variableName];
  const selectedValues = Array.isArray(selected) ? selected : selected === undefined ? [] : [selected];
  return selectedValues.some((value) => visibilityRule.values.includes(value));
}
