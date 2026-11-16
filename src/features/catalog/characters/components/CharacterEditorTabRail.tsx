import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Brain,
  Camera,
  Eye,
  FileText,
  Heart,
  Image,
  Library,
  MapPin,
  MessageCircle,
  Palette,
  Settings2,
  Sparkles,
  Swords,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../../../shared/lib/utils";

const TABS = [
  { id: "metadata", label: "Metadata", icon: User },
  { id: "description", label: "Description", icon: FileText },
  { id: "personality", label: "Personality", icon: Heart },
  { id: "backstory", label: "Backstory", icon: BookOpen },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "scenario", label: "Scenario", icon: MapPin },
  { id: "dialogue", label: "Dialogue", icon: MessageCircle },
  { id: "sprites", label: "Sprites", icon: Image },
  { id: "gallery", label: "Gallery", icon: Camera },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "stats", label: "Stats", icon: Swords },
  { id: "memories", label: "Memories", icon: Brain },
  { id: "behavior", label: "Behavior", icon: Sparkles },
  { id: "advanced", label: "Advanced", icon: Settings2 },
  { id: "lorebook", label: "Lorebook", icon: Library },
] as const satisfies Array<{ id: string; label: string; icon: LucideIcon }>;

export type CharacterEditorTabId = (typeof TABS)[number]["id"];

type CharacterEditorTabRailProps = {
  activeTab: CharacterEditorTabId;
  onTabChange: (tab: CharacterEditorTabId) => void;
};

/**
 * Wide: a vertical rail. Medium: the tabs wrap onto extra rows so none are hidden. Narrow (phones): one row that
 * scrolls sideways, faded at whichever edge has more tabs past it.
 */
export function CharacterEditorTabRail({ activeTab, onTabChange }: CharacterEditorTabRailProps) {
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const scrolls = nav.scrollWidth > nav.clientWidth + 1;
    const left = scrolls && nav.scrollLeft > 1;
    const right = scrolls && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
    setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth + 1) return;
    active.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  return (
    <nav
      ref={navRef}
      aria-label="Character sections"
      onScroll={measure}
      className={cn(
        "flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 @max-5xl:w-full @max-5xl:flex-row @max-5xl:flex-wrap @max-5xl:overflow-visible @max-5xl:border-r-0 @max-5xl:border-b @max-5xl:p-1.5 @max-xl:flex-nowrap @max-xl:overflow-x-auto",
        more.right && !more.left && "[mask-image:linear-gradient(to_right,black_85%,transparent)]",
        more.left && !more.right && "[mask-image:linear-gradient(to_left,black_85%,transparent)]",
        more.left && more.right && "[mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]",
      )}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-all @max-5xl:whitespace-nowrap @max-5xl:px-2.5 @max-5xl:py-1.5",
              activeTab === tab.id
                ? "bg-gradient-to-r from-pink-400/15 to-purple-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon size="0.875rem" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
