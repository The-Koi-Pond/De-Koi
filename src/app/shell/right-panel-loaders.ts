import type { ComponentType } from "react";

type PanelLoader = () => Promise<{ default: ComponentType }>;

export const RIGHT_PANEL_LOADERS = {
  "bot-browser": () =>
    import("../../features/shell/bot-browser/shell").then((module) => ({ default: module.BotBrowserPanel })),
  characters: () =>
    import("../../features/catalog/characters/panel").then((module) => ({ default: module.CharactersPanel })),
  lorebooks: () =>
    import("../../features/catalog/lorebooks/shell").then((module) => ({ default: module.LorebooksPanel })),
  presets: () => import("../../features/catalog/presets/shell").then((module) => ({ default: module.PresetsPanel })),
  connections: () =>
    import("../../features/shell/connections/shell").then((module) => ({ default: module.ConnectionsPanel })),
  agents: () => import("../../features/catalog/agents/shell").then((module) => ({ default: module.AgentsPanel })),
  personas: () => import("../../features/catalog/personas/shell").then((module) => ({ default: module.PersonasPanel })),
  gallery: () =>
    import("../../features/catalog/gallery/shell").then((module) => ({ default: module.GlobalGalleryPanel })),
  settings: () => import("../../features/shell/settings/shell").then((module) => ({ default: module.SettingsPanel })),
  help: () => import("./HelpHub").then((module) => ({ default: module.HelpHub })),
} satisfies Record<string, PanelLoader>;

type RightPanelId = keyof typeof RIGHT_PANEL_LOADERS;

const preloadedPanels = new Set<RightPanelId>();

function isRightPanelId(panel: string): panel is RightPanelId {
  return Object.hasOwn(RIGHT_PANEL_LOADERS, panel);
}

export function preloadRightPanelPanel(panel: string) {
  if (!isRightPanelId(panel) || preloadedPanels.has(panel)) return;
  preloadedPanels.add(panel);
  void RIGHT_PANEL_LOADERS[panel]().catch(() => preloadedPanels.delete(panel));
}
