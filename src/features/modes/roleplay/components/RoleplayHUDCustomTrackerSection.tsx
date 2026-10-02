import { Plus, SlidersHorizontal, X } from "lucide-react";
import type { CustomTrackerField } from "../../../../engine/contracts/types/game-state";
import { cn } from "../../../../shared/lib/utils";
import {
  appendTrackerListItem,
  createManualCustomTrackerField,
  removeTrackerListItem,
  replaceTrackerListItem,
} from "../../../runtime/world-state/index";
import { TRACKER_SECTION_AGENT_TYPES } from "../../../runtime/world-state/index";
import { InlineEdit } from "./RoleplayHUDInlineEdit";
import { TrackerSectionRefresh } from "./RoleplayHUDPanelPrimitives";
import {
  bodyClass,
  emptyClass,
  headerClass,
  sectionPadding,
  type TrackerRetryControls,
  type TrackerSectionLayout,
} from "./RoleplayHUDTrackerSectionLayout";

export function CustomTrackerSection({
  fields,
  onUpdate,
  layout = "panel",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  fields: CustomTrackerField[];
  onUpdate: (fields: CustomTrackerField[]) => void;
  layout?: TrackerSectionLayout;
} & TrackerRetryControls) {
  const addField = () => {
    onUpdate(appendTrackerListItem(fields, createManualCustomTrackerField()));
  };
  const removeField = (idx: number) => {
    onUpdate(removeTrackerListItem(fields, idx));
  };
  const updateField = (idx: number, updated: CustomTrackerField) => {
    onUpdate(replaceTrackerListItem(fields, idx, updated));
  };

  return (
    <div className={sectionPadding(layout)}>
      <div className={headerClass(layout)}>
        <span
          className={cn(
            "text-[0.625rem] font-semibold uppercase tracking-wider flex items-center gap-1",
            layout === "combined" ? "text-cyan-300/70" : "text-[var(--muted-foreground)]",
          )}
        >
          <SlidersHorizontal size={layout === "combined" ? "0.5625rem" : "0.625rem"} />
          {layout === "combined" ? `Custom (${fields.length})` : `Custom Tracker (${fields.length})`}
        </span>
        <span className="flex items-center gap-1">
          <TrackerSectionRefresh
            agentType={TRACKER_SECTION_AGENT_TYPES.custom}
            onRerunSingleTracker={onRerunSingleTracker}
            busy={isTrackerRetryBusy}
            title="Re-run custom tracker only"
          />
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-0.5 text-[0.625rem] text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <Plus size="0.625rem" /> Add
          </button>
        </span>
      </div>
      <div className={bodyClass(layout, "space-y-1")}>
        {fields.length === 0 && (
          <div className={emptyClass(layout)}>
            {layout === "combined" ? "No fields tracked" : "No fields tracked - add one above"}
          </div>
        )}
        {fields.map((field, idx) => (
          <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
            <SlidersHorizontal size="0.625rem" className="shrink-0 text-cyan-400/60" />
            <InlineEdit
              value={field.name}
              onSave={(value) => updateField(idx, { ...field, name: value })}
              className="flex-1 min-w-0"
              placeholder="Field name"
            />
            <span className="text-[var(--muted-foreground)]/40 text-[0.5625rem]">=</span>
            <InlineEdit
              value={field.value}
              onSave={(value) => updateField(idx, { ...field, value })}
              className="flex-1 min-w-0"
              placeholder="Value"
            />
            <button
              type="button"
              onClick={() => removeField(idx)}
              className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
              title="Remove field"
            >
              <X size="0.5625rem" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
