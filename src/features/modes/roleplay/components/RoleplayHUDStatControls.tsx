import { Trash2 } from "lucide-react";
import type { CharacterStat } from "../../../../engine/contracts/types/tracker-state";
import { getFiniteNumberInputValue } from "../../../../shared/lib/number-input";
import { getTrackerStatPercent } from "../../../runtime/world-state/index";
import { InlineEdit } from "./RoleplayHUDInlineEdit";

export function StatBarEditable({
  stat,
  onUpdateName,
  onUpdateValue,
  onUpdateMax,
  onRemove,
}: {
  stat: CharacterStat;
  onUpdateName?: (name: string) => void;
  onUpdateValue: (value: number) => void;
  onUpdateMax: (value: number) => void;
  onRemove?: () => void;
}) {
  const pct = getTrackerStatPercent(stat);

  return (
    <div className="group/stat relative">
      <div className="flex items-center justify-between mb-0.5">
        {onUpdateName ? (
          <InlineEdit
            value={stat.name}
            onSave={onUpdateName}
            className="text-[0.625rem]! font-medium! text-[var(--foreground)]/80!"
            placeholder="Stat name"
          />
        ) : (
          <span className="text-[0.625rem] font-medium text-[var(--foreground)]/80">{stat.name}</span>
        )}
        <div className="flex items-center gap-0.5 shrink-0 text-[0.5625rem] text-[var(--muted-foreground)]/60">
          <input
            type="number"
            value={stat.value}
            onChange={(event) => {
              onUpdateValue(getFiniteNumberInputValue(event.currentTarget.valueAsNumber, stat.value));
            }}
            className="w-12 bg-transparent text-right outline-none text-[var(--foreground)]/80 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span>/</span>
          <input
            type="number"
            value={stat.max}
            onChange={(event) => {
              onUpdateMax(getFiniteNumberInputValue(event.currentTarget.valueAsNumber, stat.max));
            }}
            className="w-12 bg-transparent outline-none text-[var(--foreground)]/80 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove stat"
          aria-label={`Remove ${stat.name || "stat"}`}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded bg-[var(--popover)]/90 text-[var(--muted-foreground)]/45 opacity-0 shadow-sm ring-1 ring-[var(--border)]/70 transition-all hover:text-[var(--destructive)] hover:opacity-100 focus-visible:opacity-100 group-hover/stat:opacity-80 max-md:opacity-80"
        >
          <Trash2 size="0.5625rem" />
        </button>
      )}
      <div className="h-1.5 rounded-full bg-[var(--muted)]/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: stat.color || "#8b5cf6" }}
        />
      </div>
    </div>
  );
}
