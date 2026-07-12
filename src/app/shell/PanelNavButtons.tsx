import {
  BookOpen,
  Bot,
  ChevronDown,
  Ellipsis,
  FileText,
  Images,
  Link,
  Search,
  Settings,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useAgentStore } from "../../shared/stores/agent.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { cn } from "../../shared/lib/utils";
import { preloadRightPanelPanel } from "./right-panel-loaders";
import { LIBRARY_NAV_ITEMS, TOOLS_NAV_ITEMS, isShellPanelDestination, type ShellNavItem } from "./shell-navigation";

const ICONS = {
  browser: Bot,
  characters: Users,
  personas: User,
  lorebooks: BookOpen,
  presets: FileText,
  gallery: Images,
  connections: Link,
  agents: Sparkles,
  settings: Settings,
  discover: Search,
} as const;

function stopTitlebarDrag(event: ReactMouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function NavMenu({
  label,
  items,
  className,
  onSelect,
  activeDestination,
}: {
  label: string;
  items: readonly ShellNavItem[];
  className?: string;
  onSelect: (item: ShellNavItem) => void;
  activeDestination?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const close = () => {
    triggerRef.current?.focus();
    setOpen(false);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      buttons[(index + offset + buttons.length) % buttons.length]?.focus();
    }
  };
  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onMouseDown={stopTitlebarDrag}
        onDoubleClick={stopTitlebarDrag}
        className="mari-titlebar-action flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--primary)]"
      >
        {label === "More navigation" ? <Ellipsis size="0.9rem" /> : null}
        <span>{label === "More navigation" ? "More" : label}</span>
        <ChevronDown size="0.75rem" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${label} destinations`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 min-w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl"
        >
          {items.map((item) => {
            const Icon = ICONS[item.icon as keyof typeof ICONS];
            return (
              <button
                key={item.destination}
                role="menuitem"
                aria-current={item.destination === activeDestination ? "page" : undefined}
                type="button"
                onFocus={() => isShellPanelDestination(item.destination) && preloadRightPanelPanel(item.destination)}
                onPointerEnter={() =>
                  isShellPanelDestination(item.destination) && preloadRightPanelPanel(item.destination)
                }
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-[var(--secondary)] focus:bg-[var(--secondary)]",
                  item.destination === activeDestination && "bg-[var(--secondary)] text-[var(--primary)]",
                )}
              >
                <Icon size="0.95rem" />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PanelNavButtons({ className, onOpenDiscover }: { className?: string; onOpenDiscover?: () => void }) {
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const failedAgentCount = useAgentStore((s) => s.failedAgentTypes.length);
  const select = (item: ShellNavItem) =>
    item.destination === "discover"
      ? onOpenDiscover?.()
      : isShellPanelDestination(item.destination) && toggleRightPanel(item.destination);
  return (
    <nav
      data-tour="panel-buttons"
      aria-label="Panel navigation"
      className={cn("mari-panel-nav hidden md:flex shrink-0 items-center gap-1", className)}
      onMouseDown={stopTitlebarDrag}
      onDoubleClick={stopTitlebarDrag}
    >
      <NavMenu
        label="Library"
        items={LIBRARY_NAV_ITEMS}
        onSelect={select}
        activeDestination={rightPanelOpen ? rightPanel : undefined}
        className="hidden xl:block"
      />
      <NavMenu
        label="Tools"
        items={TOOLS_NAV_ITEMS}
        onSelect={select}
        activeDestination={rightPanelOpen ? rightPanel : undefined}
        className="hidden xl:block"
      />
      <NavMenu
        label="More navigation"
        items={[...LIBRARY_NAV_ITEMS, ...TOOLS_NAV_ITEMS]}
        onSelect={select}
        activeDestination={rightPanelOpen ? rightPanel : undefined}
        className="xl:hidden"
      />
      {failedAgentCount > 0 ? <span className="sr-only">Agent action needs attention</span> : null}
    </nav>
  );
}
