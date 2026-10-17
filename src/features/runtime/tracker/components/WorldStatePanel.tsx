import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import type { TrackerState } from "../../../../engine/contracts/types/tracker-state";
import type { TrackerPanelSizeProfile, TrackerTemperatureUnit } from "../../../../shared/stores/ui.store";
import { cn } from "../../../../shared/lib/utils";
import type { TrackerStatePatchValue, WorldStatePatchField } from "../../world-state/types";
import { SectionHeader } from "./tracker-data-sidebar.controls";
import {
  WORLD_FREEFORM_DATE_GRID_BASE_CLASS,
  WORLD_GRID_BASE_CLASS,
  getWorldAmbienceStyle,
  getWorldDashboardGridClass,
  getWorldDateDisplay,
} from "./tracker-world.helpers";
import { WorldDateTile, WorldTimeTile } from "./WorldDateTimeTiles";
import { WorldForecastTile } from "./WorldForecastTile";
import { WorldLocationPlate } from "./WorldLocationPlate";

export function WorldStatePanel({
  state,
  trackerPanelSizeProfile,
  trackerTemperatureUnit,
  action,
  onSaveField,
  collapsed = false,
  onToggleCollapsed,
}: {
  state: TrackerState | null;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  trackerTemperatureUnit: TrackerTemperatureUnit;
  action?: ReactNode;
  onSaveField: <K extends WorldStatePatchField>(field: K, value: TrackerStatePatchValue[K]) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const dateDisplay = getWorldDateDisplay(state?.date);
  const hasFreeformDate = dateDisplay.kind === "freeform";
  const dashboardGridClass = getWorldDashboardGridClass(state?.weather, state?.temperature, state?.location, {
    hasFreeformDate,
  });

  return (
    <div
      className="relative z-10 overflow-hidden border-b border-[var(--border)] shadow-inner transition-colors duration-200"
      style={getWorldAmbienceStyle(state)}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--primary)]/20" />

      <SectionHeader
        icon={<MapPin size="0.6875rem" />}
        title="World"
        action={action}
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && (
        <div
          className={cn(
            "relative grid gap-px px-0.5 py-1 @min-[380px]:gap-0.5 @min-[380px]:px-1",
            hasFreeformDate ? WORLD_FREEFORM_DATE_GRID_BASE_CLASS : WORLD_GRID_BASE_CLASS,
            dashboardGridClass,
          )}
        >
          <WorldDateTile
            value={state?.date}
            display={dateDisplay}
            onSave={(value) => onSaveField("date", value || null)}
          />
          <WorldTimeTile value={state?.time} onSave={(value) => onSaveField("time", value || null)} />
          <WorldForecastTile
            weather={state?.weather}
            temperature={state?.temperature}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            trackerTemperatureUnit={trackerTemperatureUnit}
            onSaveWeather={(value) => onSaveField("weather", value || null)}
            onSaveTemperature={(value) => onSaveField("temperature", value || null)}
          />
          <WorldLocationPlate
            value={state?.location}
            onSave={(value) => onSaveField("location", value || null)}
            className="col-span-3 @min-[380px]:col-span-1"
          />
        </div>
      )}
    </div>
  );
}
