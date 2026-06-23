import { ME_NOTES_MODULE_ID, SPOTIFY_MINI_PLAYER_MODULE_ID } from "../../../../engine/contracts/constants/core-modules";
import type {
  CoreModuleManifest,
  CoreModuleSettings,
  CoreModuleStyleContribution,
  CoreModuleView,
} from "../../../../engine/contracts/types/core-module";

export { ME_NOTES_MODULE_ID } from "../../../../engine/contracts/constants/core-modules";

const CORE_MODULES: readonly CoreModuleManifest[] = [
  {
    id: ME_NOTES_MODULE_ID,
    name: "ME Notes",
    slug: "me-notes",
    description: "Adds a compact movable chat notepad with global, character, chat, and branch-wide note tabs.",
    version: "1.0.0",
    source: "core",
    main: "core-modules/me-notes",
    permissions: ["ui:messages", "ui:settings", "ui:overlay", "storage:plugin-memory"],
    defaultEnabled: false,
    runtime: "Floating chat notepad",
  },
  {
    id: SPOTIFY_MINI_PLAYER_MODULE_ID,
    name: "Spotify Mini Player",
    slug: "spotify-mini-player",
    description: "Adds the optional Spotify playback controls to the desktop title bar and mobile floating widget.",
    version: "1.0.0",
    source: "core",
    main: "core-modules/spotify-mini-player",
    permissions: ["ui:settings", "ui:overlay"],
    defaultEnabled: false,
    runtime: "Desktop title-bar player and mobile floating widget",
  },
] as const;

const CORE_MODULE_STYLES: Record<string, string> = {};
const CORE_MODULE_SURFACES: Record<string, number> = {
  [ME_NOTES_MODULE_ID]: 1,
  [SPOTIFY_MINI_PLAYER_MODULE_ID]: 2,
};

function isModuleEnabled(module: CoreModuleManifest, settings: CoreModuleSettings): boolean {
  return settings.enabled[module.id] ?? module.defaultEnabled;
}

export function isCoreModuleEnabled(moduleId: string, settings: CoreModuleSettings): boolean {
  const module = CORE_MODULES.find((item) => item.id === moduleId);
  return module ? isModuleEnabled(module, settings) : false;
}

export function coreModuleViews(settings: CoreModuleSettings): CoreModuleView[] {
  return CORE_MODULES.map((module) => {
    const enabled = isModuleEnabled(module, settings);
    return {
      ...module,
      enabled,
      status: enabled ? "enabled" : "disabled",
      styles: CORE_MODULE_STYLES[module.id] ? 1 : 0,
      surfaces: CORE_MODULE_SURFACES[module.id] ?? 0,
    };
  });
}

export function enabledCoreModuleStyles(settings: CoreModuleSettings): CoreModuleStyleContribution[] {
  return CORE_MODULES.flatMap((module) => {
    const css = CORE_MODULE_STYLES[module.id];
    if (!css || !isModuleEnabled(module, settings)) return [];
    return [{ moduleId: module.id, css }];
  });
}
