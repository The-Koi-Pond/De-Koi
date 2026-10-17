import { Package, Plus, X } from "lucide-react";
import type { InventoryItem } from "../../../../engine/contracts/types/tracker-state";
import { getFiniteNumberInputValue } from "../../../../shared/lib/number-input";
import { cn } from "../../../../shared/lib/utils";
import {
  appendTrackerListItem,
  createManualInventoryItem,
  removeTrackerListItem,
  replaceTrackerListItem,
} from "../../../runtime/world-state/index";
import { InlineEdit } from "./RoleplayHUDInlineEdit";
import {
  bodyClass,
  emptyClass,
  headerClass,
  sectionPadding,
  type TrackerSectionLayout,
} from "./RoleplayHUDTrackerSectionLayout";

export function InventoryTrackerSection({
  items,
  onUpdate,
  layout = "panel",
}: {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
  layout?: TrackerSectionLayout;
}) {
  const addItem = () => {
    onUpdate(appendTrackerListItem(items, createManualInventoryItem()));
  };
  const removeItem = (idx: number) => {
    onUpdate(removeTrackerListItem(items, idx));
  };
  const updateItem = (idx: number, updated: InventoryItem) => {
    onUpdate(replaceTrackerListItem(items, idx, updated));
  };

  return (
    <div className={sectionPadding(layout)}>
      <div className={headerClass(layout)}>
        <span
          className={cn(
            "text-[0.625rem] font-semibold uppercase tracking-wider flex items-center gap-1",
            layout === "combined" ? "text-amber-300/70" : "text-[var(--muted-foreground)]",
          )}
        >
          <Package size={layout === "combined" ? "0.5625rem" : "0.625rem"} /> Inventory ({items.length})
        </span>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-0.5 text-[0.625rem] text-amber-400 hover:text-amber-300 transition-colors"
        >
          <Plus size="0.625rem" /> Add
        </button>
      </div>
      <div className={bodyClass(layout, "space-y-1")}>
        {items.length === 0 && <div className={emptyClass(layout)}>Inventory empty</div>}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/20 px-2 py-1.5">
            <Package size="0.625rem" className="shrink-0 text-amber-400/60" />
            <InlineEdit
              value={item.name}
              onSave={(value) => updateItem(idx, { ...item, name: value })}
              className={cn("flex-1", layout === "panel" && "min-w-0")}
              placeholder="Item name"
            />
            <input
              type="number"
              value={item.quantity}
              onChange={(event) => {
                const quantity = getFiniteNumberInputValue(event.currentTarget.valueAsNumber, item.quantity, {
                  min: 0,
                });
                updateItem(idx, { ...item, quantity });
              }}
              className="w-8 bg-transparent text-center text-[0.5625rem] text-[var(--foreground)]/60 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              title="Quantity"
            />
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="text-[var(--muted-foreground)]/40 hover:text-red-500 transition-colors shrink-0"
              title="Remove item"
              aria-label={`Remove ${item.name || "item"}`}
            >
              <X size="0.5625rem" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
