import type { DiscoveryEntry } from "../discovery-types";

export const DISCOVERY_TASKS = [
  { id: "start", label: "Start chatting", featureIds: ["conversation-mode", "roleplay-mode", "game-mode", "no-model-showcase"] },
  { id: "customize", label: "Customize characters and worlds", featureIds: ["characters", "personas", "lorebooks", "themes-fonts-backgrounds"] },
  { id: "responses", label: "Improve responses", featureIds: ["presets", "prompt-overrides", "chat-memory-summaries", "swipes-rerolls"] },
  { id: "media", label: "Add images, voice, or music", featureIds: ["image-generation", "tts", "music-dj", "global-gallery"] },
  { id: "data", label: "Import or back up data", featureIds: ["imports", "backups-profile-export", "privacy-data-controls"] },
  { id: "help", label: "Troubleshoot something", featureIds: ["help-hub", "health-diagnostics", "report-bug", "deki"] },
] as const;

export type DiscoveryTaskId = (typeof DISCOVERY_TASKS)[number]["id"];

export function filterEntriesForDiscoveryTask(entries: readonly DiscoveryEntry[], taskId: DiscoveryTaskId) {
  const task = DISCOVERY_TASKS.find((candidate) => candidate.id === taskId);
  if (!task) return [];
  const ids = new Set<string>(task.featureIds);
  return entries.filter((entry) => ids.has(entry.id));
}
