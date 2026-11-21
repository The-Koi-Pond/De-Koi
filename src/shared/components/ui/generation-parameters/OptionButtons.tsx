import { cn } from "../../../lib/utils";
import { FieldLabel } from "./field-parts";

type OptionTint = "primary" | "purple" | "blue";

const SELECTED_CLASS: Record<OptionTint, string> = {
  primary: "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/30",
  purple: "bg-purple-400/15 text-purple-400 ring-purple-400/30",
  blue: "bg-blue-400/15 text-blue-400 ring-blue-400/30",
};

export interface Option<T> {
  label: string;
  value: T;
}

interface OptionButtonsProps<T> {
  label: string;
  help: string;
  group: string;
  options: readonly Option<T>[];
  selected: T;
  tint: OptionTint;
  onSelect: (value: T) => void;
}

/** A wrapping row of buttons, one selected; clicking a button selects it again even when it already is. */
export function OptionButtons<T>({ label, help, group, options, selected, tint, onSelect }: OptionButtonsProps<T>) {
  return (
    <div>
      <FieldLabel label={label} help={help} />
      <div data-option-group={group} className="mt-1 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.value)}
              className={cn(
                "rounded-lg px-2 py-1 text-[0.625rem] font-medium ring-1 transition-colors",
                isSelected
                  ? SELECTED_CLASS[tint]
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
