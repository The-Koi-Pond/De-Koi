import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Hash, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../shared/lib/utils";
import type { CardDrag } from "./use-card-drag";
import { VariableBody } from "./VariableBody";
import { nameForLabels, readVariable, type ChoiceBlockRow, type PresetVariablesEditorProps } from "./variable-row";

interface VariableCardProps {
  presetId: string;
  variable: ChoiceBlockRow;
  index: number;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  reorderPending: boolean;
  /** -1 moves the card up one place, 1 down one place. */
  onMove: (delta: -1 | 1) => void;
  onUpdateVariable: PresetVariablesEditorProps["onUpdateVariable"];
  onDeleteVariable: PresetVariablesEditorProps["onDeleteVariable"];
  drag: CardDrag;
}

const ARROW_BUTTON =
  "rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-30";

function DropLine({ where }: { where: "before" | "after" }) {
  return (
    <div
      data-drop-line={where}
      className={cn(
        "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-amber-400",
        where === "before" ? "-top-[0.3125rem]" : "-bottom-[0.3125rem]",
      )}
    />
  );
}

export function VariableCard({
  presetId,
  variable,
  index,
  count,
  expanded,
  onToggle,
  reorderPending,
  onMove,
  onUpdateVariable,
  onDeleteVariable,
  drag,
}: VariableCardProps) {
  // Which option's value editor is open. Kept while the card is collapsed (its text is not).
  const [editingOption, setEditingOption] = useState<number | null>(null);
  const view = readVariable(variable);
  const labelName = nameForLabels(view.name);
  const pill = view.multiSelect ? (view.randomPick ? "random" : "multi") : view.isBoolean ? "boolean" : null;

  // A second Delete while this variable's confirm is open or its delete runs does nothing (spec follow-up 10).
  const confirming = useRef(false);
  const deletingThis = onDeleteVariable.isPending && onDeleteVariable.variables?.variableId === variable.id;
  const confirmDelete = async () => {
    if (confirming.current || deletingThis) return;
    confirming.current = true;
    try {
      const confirmed = await showConfirmDialog({
        title: "Delete Variable",
        message: `Delete variable "${view.name}"?`,
        confirmLabel: "Delete",
        tone: "destructive",
      });
      if (confirmed) onDeleteVariable.mutate({ presetId, variableId: variable.id });
    } finally {
      confirming.current = false;
    }
  };

  return (
    <div
      data-card-index={index}
      draggable
      onDragStart={(event) => drag.dragStart(event, index)}
      onDragEnd={drag.dragEnd}
      className={cn(
        "relative rounded-xl border border-amber-400/20 bg-amber-400/5",
        drag.draggedIndex === index && "opacity-40",
      )}
    >
      {drag.dropIndex === index && <DropLine where="before" />}
      {drag.dropIndex === count && index === count - 1 && <DropLine where="after" />}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex shrink-0 items-center gap-0.5">
          <div
            title="Drag to reorder"
            aria-hidden="true"
            onMouseDown={() => drag.gripDown(index)}
            className="rounded p-0.5"
          >
            <GripVertical size="0.875rem" className="text-[var(--muted-foreground)]" />
          </div>
          <button
            type="button"
            title="Move up"
            aria-label={`Move ${labelName} up`}
            disabled={index === 0 || reorderPending}
            onClick={() => onMove(-1)}
            className={ARROW_BUTTON}
          >
            <ArrowUp size="0.75rem" />
          </button>
          <button
            type="button"
            title="Move down"
            aria-label={`Move ${labelName} down`}
            disabled={index === count - 1 || reorderPending}
            onClick={() => onMove(1)}
            className={ARROW_BUTTON}
          >
            <ArrowDown size="0.75rem" />
          </button>
        </div>
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${labelName}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="shrink-0 rounded p-0.5"
        >
          {expanded ? (
            <ChevronDown size="0.875rem" className="text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRight size="0.875rem" className="text-[var(--muted-foreground)]" />
          )}
        </button>
        <Hash size="0.875rem" className="shrink-0 text-amber-400" />
        <span onClick={onToggle} className="min-w-0 flex-1 truncate text-sm font-medium text-amber-400">
          {view.name as ReactNode}
        </span>
        <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber-400">
          {view.options.length} options
        </span>
        {pill && (
          <span className="shrink-0 rounded bg-purple-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-purple-400">
            {pill}
          </span>
        )}
        <code className="hidden shrink-0 font-mono text-[0.625rem] text-[var(--muted-foreground)] sm:inline">
          {`{{${view.name}}}`}
        </code>
        <button
          type="button"
          title="Delete variable"
          aria-label={`Delete ${labelName}`}
          onClick={() => void confirmDelete()}
          className="shrink-0 rounded-lg p-1 hover:bg-[var(--destructive)]/10"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
      {expanded && (
        <VariableBody
          view={view}
          update={(data) => onUpdateVariable.mutate({ presetId, variableId: variable.id, ...data })}
          editingOption={editingOption}
          onEditOption={setEditingOption}
        />
      )}
    </div>
  );
}
