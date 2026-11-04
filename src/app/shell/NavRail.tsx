import { useAgentStore } from "../../shared/stores/agent.store";
import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { cn } from "../../shared/lib/utils";
import {
  isShellPanelTabOpen,
  SHELL_PANEL_ITEMS,
  type ShellPanelDestination,
} from "../../shared/components/shell-navigation";
import {
  PondAgentsIcon,
  PondCharactersIcon,
  PondChatsIcon,
  PondConnectionsIcon,
  PondGalleryIcon,
  PondHelpIcon,
  PondHomeIcon,
  PondLorebooksIcon,
  PondPresetsIcon,
  PondSettingsIcon,
  type PondIcon,
} from "../../shared/components/pond-icons";
import { getToggledAppShellLeftSidebarPanel, type AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";
import { preloadRightPanelPanel } from "./right-panel-loaders";
import { useIsHomeSurface } from "./use-home-surface";

/*
 * The Pond theme's navigation on desktop: a narrow rail down the left edge
 * instead of icons in the title bar (DESIGN.md section 7). The logo at the
 * top is Deki-senpai's chat; then Home and Chats; the library; Connections
 * and Agents (Settings and Help are in the status strip's bottom-right corner).
 * Icons only (De-Koi's own, from pond-icons.tsx), each with its name as a
 * tooltip; the open one fills its cell. Styles: pond.css ("The navigation rail"). The items come
 * from shell-navigation.ts, the same list the title bar and the phone menu use.
 */

// Every menu panel needs its icon here (a new panel fails the type check until it has one).
const PANEL_ICONS: Record<(typeof SHELL_PANEL_ITEMS)[number]["destination"], PondIcon> = {
  characters: PondCharactersIcon,
  lorebooks: PondLorebooksIcon,
  presets: PondPresetsIcon,
  gallery: PondGalleryIcon,
  connections: PondConnectionsIcon,
  agents: PondAgentsIcon,
  // Drawn in the status strip, not the rail.
  settings: PondSettingsIcon,
  help: PondHelpIcon,
};

const LIBRARY = SHELL_PANEL_ITEMS.filter((item) => item.group === "library");
// Settings and Help sit in the status strip's bottom-right corner instead (UserStatusBar.tsx).
const IN_STATUS_STRIP: readonly ShellPanelDestination[] = ["help", "settings"];
const TOOLS = SHELL_PANEL_ITEMS.filter((item) => item.group === "tools" && !IN_STATUS_STRIP.includes(item.destination));

function RailButton({
  label,
  icon: Icon,
  active,
  onClick,
  onPreload,
  badge = false,
  tourTarget,
}: {
  label: string;
  icon: PondIcon;
  active: boolean;
  onClick: () => void;
  onPreload?: () => void;
  badge?: boolean;
  /** The first-run tour's anchor (`data-tour`), for the button it points at. */
  tourTarget?: string;
}) {
  return (
    <button
      type="button"
      className={cn("pond-rail-button", active && "pond-rail-button-active")}
      onClick={() => {
        onPreload?.();
        onClick();
      }}
      onFocus={onPreload}
      onPointerEnter={onPreload}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-tour={tourTarget}
    >
      <Icon size="1.5rem" aria-hidden />
      {badge && <span className="pond-rail-badge" aria-hidden />}
    </button>
  );
}

export function NavRail({
  dekiOpen,
  columnPanelOpen,
  leftSidebarPanel,
  onLeftSidebarPanelChange,
  onGoHome,
}: {
  dekiOpen: boolean;
  /** A panel (Characters, Lorebooks...) fills the column beside the rail, where the chat list goes. */
  columnPanelOpen: boolean;
  leftSidebarPanel: AppShellLeftSidebarPanel;
  onLeftSidebarPanelChange: (panel: AppShellLeftSidebarPanel) => void;
  onGoHome: () => void;
}) {
  const theme = useUIStore((s) => s.theme);
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const failedAgentCount = useAgentStore((s) => s.failedAgentTypes.length);
  // Panels open in the column beside the page, so Home can show alongside one.
  const isHomeSurface = useIsHomeSurface(dekiOpen, { panelsBesidePage: true });
  const dekiActive = leftSidebarPanel === "deki" && !columnPanelOpen;
  const chatsActive = leftSidebarPanel === "chats" && !columnPanelOpen;

  // Chats and Deki-senpai's list share the column with the panels: with a
  // panel there, their button brings their list back instead of closing it.
  const showList = (list: "chats" | "deki") => {
    if (columnPanelOpen) {
      closeRightPanel();
      onLeftSidebarPanelChange(list);
      return;
    }
    onLeftSidebarPanelChange(getToggledAppShellLeftSidebarPanel(leftSidebarPanel, list));
  };

  // Leaves the column as it is: it sits beside the page, not on it.
  const goHome = () => {
    setActiveChatId(null);
    closeAllDetails();
    onGoHome();
  };

  const panelButton = ({ destination, label }: (typeof SHELL_PANEL_ITEMS)[number]) => {
    const Icon = PANEL_ICONS[destination];
    const failedAgents = destination === "agents" && failedAgentCount > 0;
    const active = isShellPanelTabOpen(destination, rightPanel, rightPanelOpen);
    return (
      <RailButton
        key={destination}
        label={failedAgents ? `${label} (${failedAgentCount} failed)` : label}
        icon={Icon}
        active={active}
        onClick={() => (active ? closeRightPanel() : openRightPanel(destination))}
        onPreload={() => preloadRightPanelPanel(destination)}
        badge={failedAgents}
      />
    );
  };

  return (
    // `panel-buttons`: the first-run tour's "Workspace Navigation" step points at the whole rail.
    <nav className="pond-rail" aria-label="Main navigation" data-component="NavRail" data-tour="panel-buttons">
      {/* The De-Koi logo (Deki in a speech bubble) is Deki-senpai's chat. */}
      <button
        type="button"
        className={cn("pond-rail-deki", dekiActive && "pond-rail-button-active")}
        onClick={() => showList("deki")}
        title="Deki-senpai"
        aria-label="Deki-senpai"
        aria-pressed={dekiActive}
      >
        {/* The logo's outline follows De-Koi's own theme setting, as on Home. */}
        <img src={theme === "light" ? "/de-koi-logo.svg" : "/de-koi-logo-dark.svg"} alt="" draggable={false} />
      </button>

      <button
        type="button"
        className={cn("pond-rail-button", isHomeSurface && "pond-rail-button-active")}
        onClick={goHome}
        title="Home"
        aria-label="Home"
        aria-current={isHomeSurface ? "page" : undefined}
      >
        <PondHomeIcon size="1.5rem" aria-hidden />
      </button>
      <RailButton
        label={chatsActive ? "Close chats" : "Open chats"}
        icon={PondChatsIcon}
        active={chatsActive}
        onClick={() => showList("chats")}
        tourTarget="sidebar-toggle"
      />

      <span className="pond-rail-divider" aria-hidden />
      {LIBRARY.map(panelButton)}
      <span className="pond-rail-divider" aria-hidden />
      {TOOLS.map(panelButton)}
    </nav>
  );
}
