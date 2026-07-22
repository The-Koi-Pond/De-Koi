import {
  BookOpen,
  Bot,
  CircleHelp,
  FileText,
  Images,
  Link,
  MessageCircleHeart,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ShellPanelDestination =
  | "bot-browser"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "gallery"
  | "connections"
  | "agents"
  | "settings"
  | "help";

export type ShellNavDestination = "chats" | "deki" | ShellPanelDestination | "discover";
export type ShellNavGroup = "primary" | "library" | "tools";

export interface ShellNavItem {
  destination: ShellNavDestination;
  label: string;
  group: ShellNavGroup;
  icon: LucideIcon;
  accentRole: "primary" | "accent" | "muted";
}

export const SHELL_ACCENT_STYLES = {
  primary: {
    text: "text-[var(--primary)]",
    hoverText: "hover:text-[var(--primary)]",
    icon: "bg-[var(--primary)]/15 text-[var(--primary)]",
    indicator: "bg-[var(--primary)]",
  },
  accent: {
    text: "text-[var(--accent-foreground)]",
    hoverText: "hover:text-[var(--accent-foreground)]",
    icon: "bg-[var(--accent)] text-[var(--accent-foreground)]",
    indicator: "bg-[var(--accent-foreground)]",
  },
  muted: {
    text: "text-[var(--muted-foreground)]",
    hoverText: "hover:text-[var(--foreground)]",
    icon: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
    indicator: "bg-[var(--muted-foreground)]",
  },
} as const;

export const SHELL_NAV_ITEMS = [
  { destination: "chats", label: "Chats", group: "primary", icon: MessageSquare, accentRole: "muted" },
  { destination: "deki", label: "Deki-senpai", group: "primary", icon: MessageCircleHeart, accentRole: "muted" },
  {
    destination: "bot-browser",
    label: "Browser",
    group: "library",
    icon: Bot,
    accentRole: "accent",
  },
  {
    destination: "characters",
    label: "Characters",
    group: "library",
    icon: Users,
    accentRole: "accent",
  },
  {
    destination: "personas",
    label: "Personas",
    group: "library",
    icon: User,
    accentRole: "accent",
  },
  {
    destination: "lorebooks",
    label: "Lorebooks",
    group: "library",
    icon: BookOpen,
    accentRole: "accent",
  },
  {
    destination: "presets",
    label: "Presets",
    group: "library",
    icon: FileText,
    accentRole: "accent",
  },
  {
    destination: "gallery",
    label: "Gallery",
    group: "library",
    icon: Images,
    accentRole: "accent",
  },
  {
    destination: "connections",
    label: "Connections",
    group: "tools",
    icon: Link,
    accentRole: "primary",
  },
  { destination: "agents", label: "Agents", group: "tools", icon: Sparkles, accentRole: "primary" },
  {
    destination: "settings",
    label: "Settings",
    group: "tools",
    icon: Settings,
    accentRole: "primary",
  },
  {
    destination: "help",
    label: "Help",
    group: "tools",
    icon: CircleHelp,
    accentRole: "primary",
  },
  {
    destination: "discover",
    label: "Discover",
    group: "tools",
    icon: Search,
    accentRole: "primary",
  },
] as const satisfies readonly ShellNavItem[];

export const PRIMARY_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "primary");
export const LIBRARY_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "library");
export const TOOLS_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) => item.group === "tools");
export const SHELL_PANEL_ITEMS = SHELL_NAV_ITEMS.filter(
  (item): item is (typeof SHELL_NAV_ITEMS)[number] & { destination: ShellPanelDestination } =>
    isShellPanelDestination(item.destination),
);

export const SHELL_PANEL_BY_DESTINATION = Object.fromEntries(
  SHELL_PANEL_ITEMS.map((item) => [item.destination, item]),
) as Record<ShellPanelDestination, (typeof SHELL_PANEL_ITEMS)[number]>;

export function isShellPanelDestination(destination: ShellNavDestination): destination is ShellPanelDestination {
  return destination !== "chats" && destination !== "deki" && destination !== "discover";
}
