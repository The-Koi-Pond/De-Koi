import { CheckCircle2, Circle, Plus, Target, X } from "lucide-react";
import type { QuestProgress } from "../../../../engine/contracts/types/game-state";
import { cn } from "../../../../shared/lib/utils";
import {
  addQuestObjective,
  removeQuestObjective,
  toggleQuestObjectiveCompletion,
  updateQuestObjectiveText,
} from "../../../runtime/world-state/index";
import { InlineEdit } from "./RoleplayHUDInlineEdit";

export function QuestCardEditable({
  quest,
  onUpdate,
  onRemove,
}: {
  quest: QuestProgress;
  onUpdate: (quest: QuestProgress) => void;
  onRemove: () => void;
}) {
  const addObjective = () => {
    onUpdate(addQuestObjective(quest));
  };

  const toggleObjective = (idx: number) => {
    onUpdate(toggleQuestObjectiveCompletion(quest, idx));
  };

  const removeObjective = (idx: number) => {
    onUpdate(removeQuestObjective(quest, idx));
  };

  const updateObjectiveText = (idx: number, text: string) => {
    onUpdate(updateQuestObjectiveText(quest, idx, text));
  };

  const completed = quest.objectives.filter((objective) => objective.completed).length;
  const total = quest.objectives.length;

  return (
    <div className="rounded-lg bg-[var(--muted)]/20 p-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onUpdate({ ...quest, completed: !quest.completed })}
          title={quest.completed ? "Mark incomplete" : "Mark complete"}
          aria-label={quest.completed ? "Mark quest incomplete" : "Mark quest complete"}
        >
          {quest.completed ? (
            <CheckCircle2 size="0.6875rem" className="text-emerald-400 shrink-0" />
          ) : (
            <Target size="0.6875rem" className="text-amber-400 shrink-0" />
          )}
        </button>
        <InlineEdit
          value={quest.name}
          onSave={(value) => onUpdate({ ...quest, name: value })}
          className={cn("flex-1 font-medium!", quest.completed && "line-through opacity-50")}
          placeholder="Quest name"
        />
        {total > 0 && (
          <span className="text-[0.5625rem] text-[var(--muted-foreground)]/60">
            {completed}/{total}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
          title="Remove quest"
          aria-label={`Remove ${quest.name || "quest"}`}
        >
          <X size="0.5625rem" />
        </button>
      </div>
      {!quest.completed && (
        <div className="mt-1 space-y-0.5 pl-4">
          {quest.objectives.map((objective, idx) => (
            <div key={idx} className="group flex items-center gap-1 text-[0.5625rem]">
              <button
                type="button"
                onClick={() => toggleObjective(idx)}
                aria-label={objective.completed ? "Mark objective incomplete" : "Mark objective complete"}
              >
                {objective.completed ? (
                  <CheckCircle2 size="0.5rem" className="text-emerald-400/60 shrink-0" />
                ) : (
                  <Circle size="0.5rem" className="text-[var(--muted-foreground)]/40 shrink-0" />
                )}
              </button>
              <InlineEdit
                value={objective.text}
                onSave={(value) => updateObjectiveText(idx, value)}
                className={cn("flex-1", objective.completed && "line-through opacity-50")}
                placeholder="Objective"
              />
              <button
                type="button"
                onClick={() => removeObjective(idx)}
                className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)]/40 hover:text-red-500 transition-all shrink-0"
                aria-label="Remove objective"
              >
                <X size="0.4375rem" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addObjective}
            className="flex items-center gap-0.5 text-[0.5625rem] text-[var(--muted-foreground)]/40 hover:text-[var(--muted-foreground)] transition-colors mt-0.5"
          >
            <Plus size="0.4375rem" /> objective
          </button>
        </div>
      )}
    </div>
  );
}
