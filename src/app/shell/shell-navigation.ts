export type ShellPanelDestination =
  | "bot-browser"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "gallery"
  | "connections"
  | "agents"
  | "settings";

export type ShellNavDestination = "chats" | "deki" | ShellPanelDestination | "discover";
export type ShellNavGroup = "primary" | "library" | "tools";

export interface ShellNavItem {
  destination: ShellNavDestination;
  label: string;
  group: ShellNavGroup;
  icon:
    | "browser"
    | "characters"
    | "personas"
    | "lorebooks"
    | "presets"
    | "gallery"
    | "connections"
    | "agents"
    | "settings"
    | "discover"
    | "chats"
    | "deki";
  gradient?: string;
}

export const SHELL_NAV_ITEMS = [
  { destination: "chats", label: "Chats", group: "primary", icon: "chats" },
  { destination: "deki", label: "Deki-senpai", group: "primary", icon: "deki" },
  {
    destination: "bot-browser",
    label: "Browser",
    group: "library",
    icon: "browser",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    destination: "characters",
    label: "Characters",
    group: "library",
    icon: "characters",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    destination: "personas",
    label: "Personas",
    group: "library",
    icon: "personas",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    destination: "lorebooks",
    label: "Lorebooks",
    group: "library",
    icon: "lorebooks",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    destination: "presets",
    label: "Presets",
    group: "library",
    icon: "presets",
    gradient: "from-purple-500 to-violet-500",
  },
  {
    destination: "gallery",
    label: "Gallery",
    group: "library",
    icon: "gallery",
    gradient: "from-fuchsia-500 to-pink-500",
  },
  {
    destination: "connections",
    label: "Connections",
    group: "tools",
    icon: "connections",
    gradient: "from-sky-500 to-blue-500",
  },
  { destination: "agents", label: "Agents", group: "tools", icon: "agents", gradient: "from-pink-500 to-purple-500" },
  {
    destination: "settings",
    label: "Settings",
    group: "tools",
    icon: "settings",
    gradient: "from-zinc-400 to-zinc-500",
  },
  {
    destination: "discover",
    label: "Discover",
    group: "tools",
    icon: "discover",
    gradient: "from-teal-500 to-cyan-500",
  },
] as const satisfies readonly ShellNavItem[];

export const PRIMARY_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "primary");
export const LIBRARY_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "library");
export const TOOLS_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "tools");

export function isShellPanelDestination(destination: ShellNavDestination): destination is ShellPanelDestination {
  return destination !== "chats" && destination !== "deki" && destination !== "discover";
}
