export const SETTINGS_TABS = [
  "general",
  "appearance",
  "themes",
  "plugins",
  "extensions",
  "import",
  "health",
  "privacy",
  "advanced",
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number];

export const SETTINGS_DESTINATIONS = [
  { id: "image-settings", tab: "general", title: "Image generation", keywords: ["images", "gallery", "dimensions"] },
  { id: "quick-replies", tab: "general", title: "Quick replies", keywords: ["toolbar", "commands", "shortcuts"] },
  { id: "notification-sounds", tab: "appearance", title: "Notification sounds", keywords: ["audio", "alerts", "sound"] },
  { id: "themes", tab: "themes", title: "Themes", keywords: ["colors", "style", "appearance"] },
  { id: "modules", tab: "plugins", title: "Modules", keywords: ["plugins", "optional", "tools"] },
  { id: "extensions", tab: "extensions", title: "Extensions", keywords: ["css", "customization", "addons"] },
  { id: "profile-import", tab: "import", title: "Import", keywords: ["profile", "SillyTavern", "restore"] },
  { id: "health-diagnostics", tab: "health", title: "Health diagnostics", keywords: ["support", "provider", "storage"] },
  { id: "privacy-data", tab: "privacy", title: "Privacy and data", keywords: ["erase", "export", "retention"] },
  { id: "prompt-overrides", tab: "advanced", title: "Prompt overrides", keywords: ["templates", "generation", "custom prompt"] },
  { id: "backups", tab: "advanced", title: "Backups and profile export", keywords: ["backup", "export", "restore"] },
] as const satisfies readonly {
  id: string;
  tab: SettingsTabId;
  title: string;
  keywords: readonly string[];
}[];

export type SettingsDestinationId = (typeof SETTINGS_DESTINATIONS)[number]["id"];

const settingsTabIds = new Set<string>(SETTINGS_TABS);
const settingsDestinationById = new Map<string, (typeof SETTINGS_DESTINATIONS)[number]>(
  SETTINGS_DESTINATIONS.map((destination) => [destination.id, destination]),
);

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === "string" && settingsTabIds.has(value);
}

export function findSettingsDestination(id: unknown) {
  return typeof id === "string" ? settingsDestinationById.get(id) : undefined;
}

export function searchSettingsDestinations(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return SETTINGS_DESTINATIONS.filter((destination) => {
    const text = [destination.title, destination.tab, ...destination.keywords].join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
