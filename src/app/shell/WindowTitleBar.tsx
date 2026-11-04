import { Home, Maximize2, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  getDesktopWindowVisualState,
  hasDesktopWindowControls,
  minimizeDesktopWindow,
  onDesktopWindowVisualStateChanged,
  startDesktopWindowDrag,
  toggleDesktopWindowFullscreen,
  toggleDesktopWindowMaximize,
  type DesktopWindowVisualState,
} from "../../shared/api/window-controls-api";
import { requestGuardedAppClose } from "../../shared/lib/app-close-guard";
import { toUserMessage } from "../../shared/lib/error-message";
import { cn } from "../../shared/lib/utils";
import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { ChatTitleControls } from "./ChatTitleControls";
import { PanelNavButtons } from "./PanelNavButtons";
import { useIsHomeSurface } from "./use-home-surface";
import type { AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";

type DesktopPlatform = "darwin" | "windows" | "linux";
type WindowControlAction = "close" | "minimize" | "maximize" | "fullscreen";

function inferDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "windows";
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes("mac") || userAgent.includes("mac os")) return "darwin";
  if (platform.includes("linux") || userAgent.includes("x11")) return "linux";
  return "windows";
}

export function WindowTitleBar({
  dekiOpen = false,
  onOpenDeki,
  onGoHome,
  leftSidebarPanel = "chats",
  onLeftSidebarPanelChange,
  titlebarAccessory,
  webMode = false,
  navInRail = false,
}: {
  dekiOpen?: boolean;
  onOpenDeki?: () => void;
  onGoHome?: () => void;
  leftSidebarPanel?: AppShellLeftSidebarPanel;
  onLeftSidebarPanelChange?: (panel: AppShellLeftSidebarPanel) => void;
  titlebarAccessory?: ReactNode;
  webMode?: boolean;
  /** The Pond theme's navigation rail shows Chats, Deki, Home and the panels, so the bar leaves them out. */
  navInRail?: boolean;
}) {
  const platform = useMemo(inferDesktopPlatform, []);
  const hasWindowControls = useMemo(hasDesktopWindowControls, []);
  const [windowVisualState, setWindowVisualState] = useState<DesktopWindowVisualState>({
    fullscreen: false,
    maximized: false,
  });
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);
  const isHomeSurface = useIsHomeSurface(dekiOpen);

  const refreshWindowVisualState = useCallback(() => {
    if (!hasWindowControls) return;
    void getDesktopWindowVisualState()
      .then(setWindowVisualState)
      .catch(() => {
        setWindowVisualState({ fullscreen: false, maximized: false });
      });
  }, [hasWindowControls]);

  useEffect(() => {
    if (!hasWindowControls) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    refreshWindowVisualState();
    void onDesktopWindowVisualStateChanged(refreshWindowVisualState).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [hasWindowControls, refreshWindowVisualState]);

  const runWindowAction = useCallback(
    (action: WindowControlAction) => {
      if (!hasWindowControls) return;
      const next =
        action === "minimize"
          ? minimizeDesktopWindow()
          : action === "maximize"
            ? toggleDesktopWindowMaximize().then(setWindowVisualState)
            : action === "fullscreen"
              ? toggleDesktopWindowFullscreen().then(setWindowVisualState)
              : requestGuardedAppClose();
      void next.catch((error) => {
        refreshWindowVisualState();
        toast.error(toUserMessage(error, { fallback: "That window action didn't work. Try again." }));
      });
    },
    [hasWindowControls, refreshWindowVisualState],
  );

  const startWindowDrag = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!hasWindowControls || event.button !== 0 || event.detail > 1) return;
      void startDesktopWindowDrag().catch(() => {});
    },
    [hasWindowControls],
  );

  const toggleMaximizeFromDragRegion = useCallback(() => {
    runWindowAction("maximize");
  }, [runWindowAction]);

  const goHome = useCallback(() => {
    setActiveChatId(null);
    closeAllDetails();
    closeRightPanel();
    onGoHome?.();
  }, [closeAllDetails, closeRightPanel, onGoHome, setActiveChatId]);

  const effectiveWebMode = webMode || !hasWindowControls;
  const showWindowControls = !effectiveWebMode;
  const controlActions: WindowControlAction[] =
    platform === "darwin" ? ["close", "minimize", "fullscreen"] : ["minimize", "maximize", "close"];
  const controls = (
    <div
      className={cn(
        "mari-window-controls flex h-full shrink-0 items-center",
        platform === "darwin" ? "order-first gap-2 pl-2 pr-3" : "order-last gap-1 pl-3 pr-2",
      )}
      aria-label="Window controls"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {controlActions.map((action) => {
        const isExpanded =
          action === "fullscreen" ? windowVisualState.fullscreen : action === "maximize" && windowVisualState.maximized;
        const label =
          action === "fullscreen"
            ? windowVisualState.fullscreen
              ? "Exit Full Screen"
              : "Enter Full Screen"
            : action === "maximize" && windowVisualState.maximized
              ? "Restore"
              : action[0]!.toUpperCase() + action.slice(1);
        const controlClassName = action === "fullscreen" ? "maximize" : action;
        return (
          <button
            key={action}
            type="button"
            className={cn(
              `mari-window-control mari-window-control-${controlClassName}`,
              platform === "darwin" && "mari-window-control-mac",
            )}
            onClick={() => runWindowAction(action)}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            aria-label={`${label} window`}
            title={label}
          >
            {action === "minimize" ? (
              <Minus aria-hidden size="0.75rem" strokeWidth={2.2} />
            ) : action === "maximize" || action === "fullscreen" ? (
              isExpanded ? (
                <Square aria-hidden size="0.625rem" strokeWidth={2.1} />
              ) : (
                <Maximize2 aria-hidden size="0.7rem" strokeWidth={2.1} />
              )
            ) : (
              <X aria-hidden size="0.75rem" strokeWidth={2.2} />
            )}
          </button>
        );
      })}
    </div>
  );

  // With the navigation in the rail, a browser tab (no window buttons) has
  // nothing left to show here unless there's an accessory (the music player).
  // The desktop app keeps the bar even while its buttons are hidden (the full-page
  // Browser): its window has no other title bar, so this is the only place to drag it.
  if (navInRail && !hasWindowControls && !titlebarAccessory) return null;

  return (
    <header
      data-component="WindowTitleBar"
      className={cn(
        "mari-window-titlebar relative z-40 flex shrink-0 items-center overflow-visible",
        navInRail && "mari-window-titlebar-slim",
      )}
      onMouseDown={startWindowDrag}
      onDoubleClick={toggleMaximizeFromDragRegion}
    >
      {platform === "darwin" && showWindowControls && controls}
      {!navInRail && (
        <ChatTitleControls
          className="pl-2.5 pr-0"
          dekiOpen={dekiOpen}
          leftSidebarPanel={leftSidebarPanel}
          onLeftSidebarPanelChange={onLeftSidebarPanelChange}
          onOpenDeki={onOpenDeki}
          onGoHome={onGoHome}
          hideHome
        />
      )}
      <div className="mari-titlebar-content flex h-full min-w-0 flex-1 items-center">
        <div
          className="mari-title-drag-region flex h-full min-w-0 flex-1 items-center justify-start pl-0.5 pr-3"
          onMouseDown={startWindowDrag}
          onDoubleClick={toggleMaximizeFromDragRegion}
        >
          {!navInRail && (
            <button
              type="button"
              className={cn(
                "mari-titlebar-action mari-title-home-button de-koi-icon-target relative rounded-md transition-all duration-200",
                isHomeSurface
                  ? "mari-titlebar-action-active text-[color-mix(in_srgb,var(--primary)_54%,var(--muted-foreground))]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--primary)]",
              )}
              onClick={goHome}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              title="Home"
              aria-label="Home"
              aria-current={isHomeSurface ? "page" : undefined}
            >
              <Home className="mari-title-icon" size="0.95rem" aria-hidden />
              {isHomeSurface && (
                <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500" />
              )}
            </button>
          )}
          {titlebarAccessory ? <div className="ml-2 hidden min-w-0 md:flex">{titlebarAccessory}</div> : null}
        </div>
        {!navInRail && (
          <div
            className="mari-window-actions flex h-full shrink-0 items-center gap-2"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <PanelNavButtons />
            <span className="mari-window-actions-divider" aria-hidden />
          </div>
        )}
      </div>
      {platform !== "darwin" && showWindowControls && controls}
    </header>
  );
}
