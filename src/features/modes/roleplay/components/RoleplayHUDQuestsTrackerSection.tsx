import { Plus, Scroll } from "lucide-react";
import type { QuestProgress } from "../../../../engine/contracts/types/tracker-state";
import { cn } from "../../../../shared/lib/utils";
import {
  appendTrackerListItem,
  createManualQuest,
  removeTrackerListItem,
  replaceTrackerListItem,
} from "../../../runtime/world-state/index";
import { TRACKER_SECTION_AGENT_TYPES } from "../../../runtime/world-state/index";
import { TrackerSectionRefresh } from "./RoleplayHUDPanelPrimitives";
import { QuestCardEditable } from "./RoleplayHUDQuestControls";
import {
  bodyClass,
  emptyClass,
  headerClass,
  sectionPadding,
  type TrackerRetryControls,
  type TrackerSectionLayout,
} from "./RoleplayHUDTrackerSectionLayout";

export function QuestsTrackerSection({
  quests,
  onUpdate,
  layout = "panel",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  quests: QuestProgress[];
  onUpdate: (quests: QuestProgress[]) => void;
  layout?: TrackerSectionLayout;
} & TrackerRetryControls) {
  const addQuest = () => {
    onUpdate(appendTrackerListItem(quests, createManualQuest()));
  };
  const removeQuest = (idx: number) => {
    onUpdate(removeTrackerListItem(quests, idx));
  };
  const updateQuest = (idx: number, updated: QuestProgress) => {
    onUpdate(replaceTrackerListItem(quests, idx, updated));
  };

  return (
    <div className={sectionPadding(layout)}>
      <div className={headerClass(layout)}>
        <span
          className={cn(
            "text-[0.625rem] font-semibold uppercase tracking-wider flex items-center gap-1",
            layout === "combined" ? "text-emerald-300/70" : "text-[var(--muted-foreground)]",
          )}
        >
          <Scroll size={layout === "combined" ? "0.5625rem" : "0.625rem"} /> Quests ({quests.length})
        </span>
        <span className="flex items-center gap-1">
          <TrackerSectionRefresh
            agentType={TRACKER_SECTION_AGENT_TYPES.quests}
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run quest tracker only"
          />
          <button
            type="button"
            onClick={addQuest}
            className="flex items-center gap-0.5 text-[0.625rem] text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </span>
      </div>
      <div className={bodyClass(layout, "space-y-2")}>
        {quests.length === 0 && <div className={emptyClass(layout)}>No active quests</div>}
        {quests.map((quest, idx) => (
          <QuestCardEditable
            key={quest.questEntryId || idx}
            quest={quest}
            onUpdate={(updatedQuest) => updateQuest(idx, updatedQuest)}
            onRemove={() => removeQuest(idx)}
          />
        ))}
      </div>
    </div>
  );
}
