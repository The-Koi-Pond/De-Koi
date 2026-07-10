import {
  DISCORD_MIRROR_MODULE_ID,
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
  ME_NOTES_MODULE_ID,
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
} from "../../../../engine/contracts/constants/core-modules";
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
    id: MUSIC_DJ_MINI_PLAYER_MODULE_ID,
    name: "Music Player",
    slug: "music-dj-mini-player",
    description:
      "Shows the Music Player controls. Generate a fresh pick here, or activate the Music Player agent in a chat when you want automatic scene-aware picks.",
    version: "1.0.0",
    source: "core",
    main: "core-modules/music-dj-mini-player",
    permissions: ["ui:settings", "ui:overlay"],
    defaultEnabled: false,
    runtime: "Desktop title-bar player and mobile floating widget",
  },
  {
    id: DISCORD_MIRROR_MODULE_ID,
    name: "Discord Mirror",
    slug: "discord-mirror",
    description: "Mirrors saved chat and game messages to a configured Discord webhook.",
    version: "1.0.0",
    source: "core",
    main: "core-modules/discord-mirror",
    permissions: ["ui:settings", "network:discord-webhook"],
    defaultEnabled: false,
    runtime: "Chat and game message webhook mirror",
    configurable: true,
  },
] as const;

const CORE_MODULE_STYLES: Record<string, string> = {};
const CORE_MODULE_SURFACES: Record<string, number> = {
  [ME_NOTES_MODULE_ID]: 1,
  [MUSIC_DJ_MINI_PLAYER_MODULE_ID]: 2,
};

function moduleEnabledSetting(module: CoreModuleManifest, settings: CoreModuleSettings): boolean | undefined {
  if (module.id === MUSIC_DJ_MINI_PLAYER_MODULE_ID) {
    return settings.enabled[MUSIC_DJ_MINI_PLAYER_MODULE_ID] ?? settings.enabled[LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID];
  }
  return settings.enabled[module.id];
}

function isModuleEnabled(module: CoreModuleManifest, settings: CoreModuleSettings): boolean {
  return moduleEnabledSetting(module, settings) ?? module.defaultEnabled;
}

function canonicalModuleId(moduleId: string): string {
  return moduleId === LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID ? MUSIC_DJ_MINI_PLAYER_MODULE_ID : moduleId;
}

export function isCoreModuleEnabled(moduleId: string, settings: CoreModuleSettings): boolean {
  const canonicalId = canonicalModuleId(moduleId);
  const module = CORE_MODULES.find((item) => item.id === canonicalId);
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
