import { LayoutGrid, MessageCircleHeart, MessageSquare } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { cn } from "../../shared/lib/utils";
import type { AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";
import { preloadRightPanelPanel } from "./right-panel-loaders";
import {
  LIBRARY_NAV_ITEMS,
  SHELL_ACCENT_STYLES,
  TOOLS_NAV_ITEMS,
  isShellPanelDestination,
  type ShellPanelDestination,
} from "../../shared/components/shell-navigation";

export function MobileTabBar({
  dekiOpen: _dekiOpen,
  leftSidebarPanel,
  toolsSheetOpen,
  toolsSheetRef,
  trackerPanelVisible,
  onToolsSheetOpenChange,
  onLeftSidebarPanelChange,
  onToggleDeki: _onToggleDeki,
  onGoHome: _onGoHome,
  onOpenDiscover,
}: {
  dekiOpen: boolean;
  leftSidebarPanel: AppShellLeftSidebarPanel;
  toolsSheetOpen: boolean;
  toolsSheetRef: RefObject<HTMLDivElement | null>;
  trackerPanelVisible: boolean;
  onToolsSheetOpenChange: (open: boolean | ((open: boolean) => boolean)) => void;
  onLeftSidebarPanelChange: (panel: AppShellLeftSidebarPanel) => void;
  onToggleDeki: () => void;
  onGoHome: () => void;
  onOpenDiscover: () => void;
}) {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const rightPanel = useUIStore((s) => s.rightPanel);

  if (activeChatId !== null) return null;

  const closeAll = () => {
    onToolsSheetOpenChange(false);
    onLeftSidebarPanelChange(null);
    closeRightPanel();
    closeAllDetails();
  };

  const openChats = () => {
    const wasOpen = leftSidebarPanel === "chats";
    closeAll();
    if (!wasOpen) onLeftSidebarPanelChange("chats");
  };

  const openDeki = () => {
    const wasOpen = leftSidebarPanel === "deki";
    closeAll();
    if (!wasOpen) onLeftSidebarPanelChange("deki");
  };

  const openPanel = (panel: ShellPanelDestination) => {
    preloadRightPanelPanel(panel);
    const wasThisPanel = rightPanelOpen && rightPanel === panel;
    closeAll();
    if (!wasThisPanel) openRightPanel(panel);
  };

  const isTools = rightPanelOpen || toolsSheetOpen;
  const isChats = leftSidebarPanel === "chats" && !rightPanelOpen && !toolsSheetOpen && !trackerPanelVisible;
  const isDeki = leftSidebarPanel === "deki" && !rightPanelOpen && !toolsSheetOpen && !trackerPanelVisible;

  return (
    <>
      {/* Scrim for tools sheet */}
      {toolsSheetOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm md:hidden"
          style={{ zIndex: 65 }}
          onClick={closeAll}
        />
      )}

      {/* Tools bottom sheet */}
      {toolsSheetOpen && (
        <div
          ref={toolsSheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Tools panels"
          tabIndex={-1}
          className="fixed left-0 right-0 max-h-[70dvh] overflow-y-auto rounded-t-3xl border-t border-[var(--border)]/50 bg-[var(--card)] shadow-2xl backdrop-blur-2xl animate-fade-in-up md:hidden"
          style={{
            zIndex: 70,
            bottom: "calc(3.5rem + env(safe-area-inset-bottom))",
            paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
          }}
        >
          {[
            { heading: "Library", items: LIBRARY_NAV_ITEMS },
            { heading: "Tools", items: TOOLS_NAV_ITEMS },
          ].map(({ heading, items }) => (
            <section key={heading}>
              <h2 className="px-5 pt-5 pb-2 text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                {heading}
              </h2>
              <div className="grid grid-cols-2 gap-2.5 px-4 pb-2 overflow-hidden">
                {items.map((item) => {
                  const Icon = item.icon;
                  const accent = SHELL_ACCENT_STYLES[item.accentRole];
                  const isActive =
                    isShellPanelDestination(item.destination) && rightPanelOpen && rightPanel === item.destination;
                  return (
                    <button
                      key={item.destination}
                      type="button"
                      onFocus={() =>
                        isShellPanelDestination(item.destination) && preloadRightPanelPanel(item.destination)
                      }
                      onPointerEnter={() =>
                        isShellPanelDestination(item.destination) && preloadRightPanelPanel(item.destination)
                      }
                      onPointerDown={() =>
                        isShellPanelDestination(item.destination) && preloadRightPanelPanel(item.destination)
                      }
                      onClick={() => {
                        if (item.destination === "discover") {
                          closeAll();
                          onOpenDiscover();
                        } else if (isShellPanelDestination(item.destination)) openPanel(item.destination);
                      }}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-95",
                        isActive
                          ? "border-[var(--primary)]/40 bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))]"
                          : "border-[var(--border)]/50 bg-[var(--secondary)]/50 hover:border-[var(--border)]",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm",
                          accent.icon,
                        )}
                      >
                        <Icon size="1rem" />
                      </div>
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          isActive ? "text-[var(--primary)]" : "text-[var(--foreground)]",
                        )}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <nav
        aria-label="Main navigation"
        className="mari-mobile-tab-bar fixed bottom-0 left-0 right-0 flex items-center justify-around overflow-hidden border-t border-[var(--border)]/40 bg-[var(--card)] pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ zIndex: 80, isolation: "isolate", transform: "translateZ(0)", willChange: "transform" }}
      >
        <TabButton icon={<MessageSquare size="1.15rem" />} label="Chats" active={isChats} onClick={openChats} />

        <TabButton
          icon={<MessageCircleHeart size="1.15rem" />}
          label="Deki-senpai"
          active={isDeki}
          onClick={openDeki}
        />

        <TabButton
          icon={<LayoutGrid size="1.15rem" />}
          label="Tools"
          active={isTools}
          onClick={() => {
            if (rightPanelOpen) {
              closeRightPanel();
            } else if (toolsSheetOpen) {
              onToolsSheetOpenChange(false);
            } else {
              onLeftSidebarPanelChange(null);
              closeAllDetails();
              onToolsSheetOpenChange(true);
            }
          }}
        />
      </nav>
    </>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "de-koi-body flex h-14 flex-col items-center justify-center gap-0.5 px-3 font-semibold tracking-wide transition-all active:scale-90",
        active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
      )}
    >
      <span className="relative flex items-center justify-center">
        {icon}
        {active && (
          <span className="absolute -top-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_70%,transparent)]" />
        )}
      </span>
      {label}
    </button>
  );
}
