import { Home, MessageCircleHeart, MessageSquare } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "../../shared/lib/utils";
import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { getToggledAppShellLeftSidebarPanel, type AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";

function stopChromeDrag(event: ReactMouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function ChatTitleControls({
  dekiOpen: _dekiOpen = false,
  leftSidebarPanel = "chats",
  onLeftSidebarPanelChange,
  onOpenDeki: _onOpenDeki,
  onGoHome,
  className,
  hideDekiOnNarrow = false,
  hideHome = false,
  hideDeki = false,
  showDivider = true,
}: {
  dekiOpen?: boolean;
  leftSidebarPanel?: AppShellLeftSidebarPanel;
  onLeftSidebarPanelChange?: (panel: AppShellLeftSidebarPanel) => void;
  onOpenDeki?: () => void;
  onGoHome?: () => void;
  className?: string;
  hideDekiOnNarrow?: boolean;
  hideHome?: boolean;
  hideDeki?: boolean;
  showDivider?: boolean;
}) {
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const chatSidebarOpen = leftSidebarPanel === "chats";
  const dekiSidebarOpen = leftSidebarPanel === "deki";
  const dekiButtonActive = dekiSidebarOpen;

  const toggleChatSidebar = () => {
    onLeftSidebarPanelChange?.(getToggledAppShellLeftSidebarPanel(leftSidebarPanel, "chats"));
  };

  const goHome = () => {
    setActiveChatId(null);
    closeAllDetails();
    onGoHome?.();
  };

  const toggleDekiSidebar = () => {
    onLeftSidebarPanelChange?.(getToggledAppShellLeftSidebarPanel(leftSidebarPanel, "deki"));
  };

  return (
    <div className={cn("mari-chat-title-controls flex h-full shrink-0 items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={toggleChatSidebar}
        onMouseDown={stopChromeDrag}
        onDoubleClick={stopChromeDrag}
        data-tour="sidebar-toggle"
        className={cn(
          "mari-titlebar-action relative rounded-md p-1.5 transition-all duration-200",
          chatSidebarOpen
            ? "mari-titlebar-action-active text-[color-mix(in_srgb,var(--primary)_54%,var(--muted-foreground))] [&>svg]:stroke-[2.3]"
            : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
        )}
        title={chatSidebarOpen ? "Close chats" : "Open chats"}
        aria-label={chatSidebarOpen ? "Close chats" : "Open chats"}
        aria-pressed={chatSidebarOpen}
      >
        <MessageSquare size="0.875rem" />
        {chatSidebarOpen && (
          <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500" />
        )}
      </button>
      {!hideHome && (
        <button
          type="button"
          onClick={goHome}
          onMouseDown={stopChromeDrag}
          onDoubleClick={stopChromeDrag}
          className="mari-titlebar-action rounded-md p-1.5 text-[var(--muted-foreground)] transition-all duration-200 hover:text-[var(--primary)]"
          title="Home"
          aria-label="Home"
        >
          <Home size="0.95rem" aria-hidden />
        </button>
      )}
      {!hideDeki && (
        <button
          type="button"
          onClick={toggleDekiSidebar}
          onMouseDown={stopChromeDrag}
          onDoubleClick={stopChromeDrag}
          className={cn(
            "mari-titlebar-action relative rounded-md p-1 transition-all duration-200",
            hideDekiOnNarrow && "mari-titlebar-action-mobile-optional",
            dekiButtonActive
              ? "mari-titlebar-action-active text-[color-mix(in_srgb,var(--primary)_54%,var(--muted-foreground))]"
              : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
          )}
          title="Deki-senpai"
          aria-label="Deki-senpai"
          aria-pressed={dekiButtonActive}
        >
          <MessageCircleHeart size="0.95rem" aria-hidden />
          {dekiButtonActive && (
            <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500" />
          )}
        </button>
      )}
      {showDivider && <span className="mari-chat-title-divider" aria-hidden />}
    </div>
  );
}
