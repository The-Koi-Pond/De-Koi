import { BUILT_IN_AGENTS } from "../../../../engine/contracts/types/agent";
import type { CharacterStat } from "../../../../engine/contracts/types/tracker-state";

export type TrackerPanelSection = "world" | "persona" | "characters" | "quests" | "custom";

export const TRACKER_AGENT_TYPE_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_AGENTS.filter((agent) => agent.category === "tracker").map((agent) => agent.id),
);

export const TRACKER_SECTION_AGENT_TYPES: Record<TrackerPanelSection, string> = {
  world: "world-state",
  persona: "persona-stats",
  characters: "character-tracker",
  quests: "quest",
  custom: "custom-tracker",
};

export const TRACKER_SECTION_RERUN_TITLES: Record<TrackerPanelSection, string> = {
  world: "Re-run world state tracker",
  persona: "Re-run persona tracker",
  characters: "Re-run character tracker",
  quests: "Re-run quest tracker",
  custom: "Re-run custom tracker",
};

export function getTrackerStatPercent(stat: Pick<CharacterStat, "value" | "max">) {
  if (!Number.isFinite(stat.max) || stat.max <= 0 || !Number.isFinite(stat.value)) return 0;
  return Math.max(0, Math.min(100, (stat.value / stat.max) * 100));
}
