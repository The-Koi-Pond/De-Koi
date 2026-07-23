// --------------------------------------------------------------
// Layout: Main App Shell (Discord-like three-column)
// --------------------------------------------------------------
import { ChatSidebar, type ChatSidebarTab } from "./ChatSidebar";
import { DekiSidebar } from "./DekiSidebar";
import { AppFindOverlay } from "./AppFindOverlay";
import { TopBar } from "./TopBar";
import { TopBarActionsProvider } from "../../shared/components/mobile-shell-actions";
import { WindowTitleBar } from "./WindowTitleBar";
import { MobileTabBar } from "./MobileTabBar";
import { DISCOVERY_APP_EVENT, type DiscoveryAppEventDetail } from "../../shared/lib/discovery-navigation";
import {
  getTrackerPanelWidthForProfile,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUIStore,
} from "../../shared/stores/ui.store";
import type { TrackerPanelSizeProfile } from "../../shared/stores/ui.store";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { useAgentStore } from "../../shared/stores/agent.store";
import { useClearAutonomousUnread } from "../../features/catalog/chats/autonomous-unread";
import { chatKeys } from "../../features/catalog/chats/index";
import { dekiApi } from "../../shared/api/deki-api";
import type { DekiSession, DekiSessionsState } from "../../engine/deki/deki-history";
import { useIsCoreModuleEnabled } from "../../features/shell/plugins/shell";
import { MUSIC_DJ_MINI_PLAYER_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { useIdleDetection } from "../../shared/hooks/use-idle-detection";
import { ImagePromptReviewHost } from "../../shared/components/ui/ImagePromptReviewHost";
import { cn } from "../../shared/lib/utils";
import { parseChatMetadata } from "../../shared/lib/chat-display";
import { watchVisualViewportHeightVar } from "../../shared/lib/visual-viewport";
import { HELP_REQUEST_EVENT } from "../../shared/lib/help-events";
import { useLocalNotificationNavigation } from "../../features/shell/actions";
import { markPerformanceMilestoneOnce } from "../../shared/lib/performance-diagnostics";
import { onDesktopWindowCloseRequested } from "../../shared/api/window-controls-api";
import {
  hasPendingAppCloseWork,
  registerBrowserBeforeUnloadGuard,
  registerEditorDirtyAppCloseGuard,
  registerEphemeralAttachmentDraftAppCloseGuard,
  requestGuardedAppClose,
} from "../../shared/lib/app-close-guard";
import { listenDraftPersistenceFailures } from "../../shared/lib/draft-persistence-events";
import {
  discoveryActionReplacesCenterSurface,
  getAutomaticMemoryCaptureToast,
  getAppShellCenterSurfaceState,
  getSetupJourneyHost,
  shouldBeginSetupJourney,
} from "./app-shell-center-surfaces";
import { closeDiscoverHistory, useDiscoverHistoryLifecycle } from "./app-shell-discover-history";
import type { AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";
import { getDekiSessionSelectAction } from "./app-shell-deki-session";
import { getDetailRouteView } from "./detail-route-registry";
import { isTrackerPanelAvailableForChatMode } from "./app-shell-tracker-panel";
import { shouldUseLowPowerShellMode, syncShellRootAttributes } from "./shell-performance";
import { usePageActivity } from "../../shared/hooks/use-page-activity";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { subscribeAutomaticMemoryCaptureCompletions } from "../../engine/generation/automatic-memory-capture-queue";
import { HelpCircle, Loader2 } from "lucide-react";
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

const ModeSurface = lazy(() =>
  import("../../features/modes/router/shell").then((module) => ({ default: module.ModeSurface })),
);
const BackgroundAutonomousPollingHost = lazy(() =>
  import("../../features/modes/conversation/background-autonomous").then((module) => ({
    default: module.BackgroundAutonomousPollingHost,
  })),
);
const DiscoverPanel = lazy(() =>
  import("../../features/shell/discovery/shell").then((module) => ({ default: module.DiscoverPanel })),
);
const BotBrowserView = lazy(() =>
  import("../../features/shell/bot-browser/shell").then((module) => ({ default: module.BotBrowserView })),
);
const GameAssetsBrowserView = lazy(() =>
  import("../../features/modes/game-assets/shell").then((module) => ({ default: module.GameAssetsBrowserView })),
);
const RightPanel = lazy(() => import("./RightPanel").then((module) => ({ default: module.RightPanel })));
const TrackerDataSidebar = lazy(() =>
  import("../../features/runtime/tracker/shell").then((module) => ({ default: module.TrackerDataSidebar })),
);
const OnboardingTutorial = lazy(() =>
  import("../../features/shell/onboarding/shell").then((module) => ({ default: module.OnboardingTutorial })),
);
const SetupReadinessJourney = lazy(() =>
  import("../../features/shell/onboarding/shell").then((module) => ({ default: module.SetupReadinessJourney })),
);
const DekiSurface = lazy(() =>
  import("../../features/shell/deki/shell").then((module) => ({ default: module.DekiSurface })),
);
const ChatNotificationBubbles = lazy(() =>
  import("../../features/shell/notifications/shell").then((module) => ({
    default: module.ChatNotificationBubbles,
  })),
);
const AgentDebugPanel = lazy(() =>
  import("../../features/catalog/agents/debug-shell").then((module) => ({
    default: module.AgentDebugPanel,
  })),
);
const MusicFloatingWidget = lazy(() =>
  import("../../features/shell/music/shell").then((module) => ({ default: module.MusicFloatingWidget })),
);
const MusicToolbarPlayer = lazy(() =>
  import("../../features/shell/music/shell").then((module) => ({ default: module.MusicToolbarPlayer })),
);

function clampWidth(width: number, min: number, max: number) {
  return Math.max(min, Math.min(max, width));
}

function getMobileTrackerPanelWidthForProfile(profile: TrackerPanelSizeProfile) {
  switch (profile) {
    case "compact":
      return "min(4.5rem, 24vw)";
    case "expanded":
      return "min(24rem, 82vw)";
    case "standard":
    default:
      return "min(18rem, 62vw)";
  }
}

const PANEL_RESIZE_STEP = 16;
const NOTIFICATION_BUBBLES_EXIT_MS = 500;
const PANEL_RESIZE_LARGE_STEP = 48;
const SHARED_PANEL_WIDTH_MIN = Math.max(SIDEBAR_WIDTH_MIN, RIGHT_PANEL_WIDTH_MIN);
const SHARED_PANEL_WIDTH_MAX = Math.min(SIDEBAR_WIDTH_MAX, RIGHT_PANEL_WIDTH_MAX);
const RESIZER_HITBOX = 10;
const TRACKER_PANEL_EDGE_OFFSET = 8;
const TRACKER_PANEL_HUD_GAP = 6;
const TRACKER_PANEL_TOGGLE_SELECTOR = '[data-tracker-panel-toggle="roleplay-hud"]';
const TRACKER_PANEL_ANCHOR_SELECTOR = '[data-tracker-panel-anchor="roleplay-hud"]';
const TOP_BAR_SELECTOR = '[data-component="TopBar"]';
const MOBILE_PANEL_HISTORY_KEY = "__marinaraMobilePanel";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const loadRightPanelShell = () => import("./RightPanel");

function requestIdleWork(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1800 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, 900);
  return () => window.clearTimeout(id);
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[inert]")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function setInert(element: HTMLElement | null, inert: boolean) {
  if (!element) return;
  element.toggleAttribute("inert", inert);
  (element as HTMLElement & { inert?: boolean }).inert = inert;
}

function getSharedPanelWidth(sidebarWidth: number, rightPanelWidth: number) {
  return clampWidth(rightPanelWidth || sidebarWidth, SHARED_PANEL_WIDTH_MIN, SHARED_PANEL_WIDTH_MAX);
}

function isMobilePanelHistoryState(state: unknown, token: string) {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[MOBILE_PANEL_HISTORY_KEY] === token
  );
}

function getHistoryStateRecord() {
  return typeof window.history.state === "object" && window.history.state !== null
    ? (window.history.state as Record<string, unknown>)
    : {};
}

function ShellLoadingFallback({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center", compact ? "h-full" : "flex-1")}>
      <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] shadow-sm">
        <Loader2 size="0.875rem" className="animate-spin text-[var(--primary)]" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

function MainPaneFallback() {
  return <ShellLoadingFallback />;
}
/** Mounts children once `open` becomes true, then keeps them mounted so state persists.
 *  `overlay` mode uses CSS slide-in and never unmounts. */
function MountOnceWhenOpened({
  open,
  children,
  overlay,
  hideOverlayWhenClosed,
  slideFromBottom,
}: {
  open: boolean;
  children: React.ReactNode;
  overlay?: boolean;
  hideOverlayWhenClosed?: boolean;
  slideFromBottom?: boolean;
}) {
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open && !everOpened) setEverOpened(true);
  }, [open, everOpened]);
  if (!everOpened) return null;
  if (overlay) {
    return (
      <div
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden bg-[var(--background)] transition-[opacity,transform] duration-200 ease-out",
          open ? "z-20 translate-x-0 translate-y-0 opacity-100" : "z-10 pointer-events-none opacity-0",
          !open && (slideFromBottom ? "translate-y-8" : "translate-x-8"),
        )}
        style={hideOverlayWhenClosed && !open ? { display: "none" } : undefined}
      >
        <Suspense fallback={<MainPaneFallback />}>{children}</Suspense>
      </div>
    );
  }
  return (
    <div className={open ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
      <Suspense fallback={<MainPaneFallback />}>{children}</Suspense>
    </div>
  );
}

function SidePanelFallback() {
  return <ShellLoadingFallback compact />;
}

export function AppShell() {
  useLocalNotificationNavigation();
  // Auto idle detection (10 min inactivity -> idle, activity -> active)
  useIdleDetection();
  const isPageActive = usePageActivity();

  useEffect(() => {
    markPerformanceMilestoneOnce("shell.ready");
  }, []);
  useEffect(() => {
    return listenDraftPersistenceFailures((detail) => {
      toast.error(detail.message, { id: "draft-persistence-warning" });
    });
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const unregisterEditorGuard = registerEditorDirtyAppCloseGuard(() => useUIStore.getState().editorDirty);
    const unregisterRoleplayAttachmentGuard = registerEphemeralAttachmentDraftAppCloseGuard("roleplay");
    const unregisterBeforeUnloadGuard = registerBrowserBeforeUnloadGuard();
    void onDesktopWindowCloseRequested(() => {
      void requestGuardedAppClose();
    }, hasPendingAppCloseWork).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
      unregisterBeforeUnloadGuard();
      unregisterRoleplayAttachmentGuard();
      unregisterEditorGuard();
    };
  }, []);

  const queryClient = useQueryClient();
  const [backgroundAutonomousPollingReady, setBackgroundAutonomousPollingReady] = useState(false);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const setRightPanelResizing = useUIStore((s) => s.setRightPanelResizing);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);
  const trackerPanelEnabled = useUIStore((s) => s.trackerPanelEnabled);
  const trackerPanelOpen = useUIStore((s) => s.trackerPanelOpen);
  const trackerPanelSide = useUIStore((s) => s.trackerPanelSide);
  const trackerPanelHideHudWidgets = useUIStore((s) => s.trackerPanelHideHudWidgets);
  const trackerPanelSizeProfile = useUIStore((s) => s.trackerPanelSizeProfile);
  const setTrackerPanelOpen = useUIStore((s) => s.setTrackerPanelOpen);
  const [sidebarDragWidth, setSidebarDragWidth] = useState<number | null>(null);
  const [rightPanelDragWidth, setRightPanelDragWidth] = useState<number | null>(null);
  const [activeChatSidebarTab, setActiveChatSidebarTab] = useState<ChatSidebarTab>("conversation");
  const [dekiOpen, setDekiOpen] = useState(false);
  const [leftSidebarPanel, setLeftSidebarPanelState] = useState<AppShellLeftSidebarPanel>("chats");
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [dekiSessions, setDekiSessions] = useState<DekiSession[]>([]);
  const [activeDekiSessionId, setActiveDekiSessionId] = useState<string | null>(null);
  const [unreadDekiSessionIds, setUnreadDekiSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const chatNotificationCount = useChatStore((s) => s.chatNotifications.size);
  const [notificationBubblesMounted, setNotificationBubblesMounted] = useState(false);
  const debugMode = useUIStore((s) => s.debugMode);
  const automaticMemoryCaptureNotifications = useUIStore((s) => s.automaticMemoryCaptureNotifications);
  const hasAgentDebugActivity = useAgentStore((s) => debugMode && (s.debugLog.length > 0 || s.lastResults.size > 0));
  const { data: musicDjMiniPlayerEnabled } = useIsCoreModuleEnabled(MUSIC_DJ_MINI_PLAYER_MODULE_ID);
  const sidebarDragWidthRef = useRef<number | null>(null);
  const rightPanelDragWidthRef = useRef<number | null>(null);
  const pendingDekiSessionIdRef = useRef<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sharedPanelWidth = getSharedPanelWidth(sidebarWidth, rightPanelWidth);
  const liveSidebarWidth = sidebarDragWidth ?? rightPanelDragWidth ?? sharedPanelWidth;
  const liveRightPanelWidth = rightPanelDragWidth ?? sidebarDragWidth ?? sharedPanelWidth;
  const chatSidebarVisible = leftSidebarPanel === "chats";
  const dekiSidebarVisible = leftSidebarPanel === "deki";
  const trackerPanelWidth = getTrackerPanelWidthForProfile(trackerPanelSizeProfile);
  const mobileTrackerPanelWidth = getMobileTrackerPanelWidthForProfile(trackerPanelSizeProfile);
  const lowPowerShellMode = shouldUseLowPowerShellMode({
    hostname: typeof window === "undefined" ? "" : window.location.hostname,
    updateSlow:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(update: slow)").matches,
  });

  useEffect(() => {
    return requestIdleWork(() => {
      void loadRightPanelShell();
    });
  }, []);

  useEffect(() => requestIdleWork(() => setBackgroundAutonomousPollingReady(true)), []);

  useEffect(
    () =>
      subscribeAutomaticMemoryCaptureCompletions((completion) => {
        const feedback = getAutomaticMemoryCaptureToast(automaticMemoryCaptureNotifications, completion);
        if (!feedback) return;
        toast.success(feedback.title, {
          description: feedback.description,
          duration: feedback.duration,
        });
      }),
    [automaticMemoryCaptureNotifications],
  );

  useEffect(() => {
    const root = document.documentElement;
    syncShellRootAttributes(root, { isPageActive, lowPowerShellMode });
    return () => {
      delete root.dataset.deKoiPageActivity;
      if (root.dataset.deKoiShellPerformance === "low") delete root.dataset.deKoiShellPerformance;
    };
  }, [isPageActive, lowPowerShellMode]);

  useEffect(() => {
    if (chatNotificationCount > 0) {
      setNotificationBubblesMounted(true);
      return;
    }
    if (!notificationBubblesMounted) return;
    const timeoutId = window.setTimeout(() => setNotificationBubblesMounted(false), NOTIFICATION_BUBBLES_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [chatNotificationCount, notificationBubblesMounted]);

  // Track mobile breakpoint for right-panel animation strategy
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Auto-close right panel when viewport is too narrow for comfort
  useEffect(() => {
    if (isMobile) return; // Mobile uses overlays, no squishing concern
    let rafId = 0;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const {
          rightPanelOpen: rp,
          sidebarWidth: sw,
          rightPanelWidth: rpw,
          closeRightPanel: close,
        } = useUIStore.getState();
        if (!rp) return;
        const panelWidth = getSharedPanelWidth(sw, rpw);
        const reserved = (leftSidebarPanel !== null ? panelWidth : 0) + panelWidth;
        if (window.innerWidth - reserved < 400) close();
      });
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafId);
    };
  }, [isMobile, leftSidebarPanel]);

  // Center-area overflow detection
  // When the center <main> content overflows horizontally, switch to compact
  // layout. Uses hysteresis to prevent toggling back-and-forth.
  const mainRef = useRef<HTMLElement>(null);
  const sidebarPanelRef = useRef<HTMLElement>(null);
  const dekiSidebarPanelRef = useRef<HTMLElement>(null);
  const mobileTrackerPanelRef = useRef<HTMLElement>(null);
  const mobileRightPanelRef = useRef<HTMLElement>(null);
  const mobileToolsPanelRef = useRef<HTMLDivElement>(null);
  const lastFocusedBeforeMobilePanelRef = useRef<HTMLElement | null>(null);
  const mobilePanelHistoryTokenRef = useRef<string | null>(null);
  const closingMobilePanelFromPopRef = useRef(false);
  const compactWidthRef = useRef(0); // width when we last switched to compact
  const centerCompact = useUIStore((s) => s.centerCompact);
  const setCenterCompact = useUIStore((s) => s.setCenterCompact);

  const checkOverflow = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const compact = useUIStore.getState().centerCompact;
    const width = el.clientWidth;

    if (compact) {
      if (width > compactWidthRef.current + 80) {
        setCenterCompact(false);
      }
    } else {
      let overflows = false;
      const scan = (node: Element, depth: number) => {
        if (overflows || depth > 3) return;
        if (node.scrollWidth > node.clientWidth + 2) {
          overflows = true;
          return;
        }
        for (let i = 0; i < node.children.length; i++) {
          scan(node.children[i]!, depth + 1);
        }
      };
      scan(el, 0);
      if (overflows) {
        compactWidthRef.current = width;
        setCenterCompact(true);
      }
    }
  }, [setCenterCompact]);

  // Debounce the overflow check so ResizeObserver doesn't cause layout thrashing
  const overflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCheckOverflow = useCallback(() => {
    if (overflowTimerRef.current) clearTimeout(overflowTimerRef.current);
    overflowTimerRef.current = setTimeout(checkOverflow, 100);
  }, [checkOverflow]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(debouncedCheckOverflow);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (overflowTimerRef.current) clearTimeout(overflowTimerRef.current);
    };
  }, [debouncedCheckOverflow]);

  const characterDetailId = useUIStore((s) => s.characterDetailId);
  const characterLibraryOpen = useUIStore((s) => s.characterLibraryOpen);
  const lorebookDetailId = useUIStore((s) => s.lorebookDetailId);
  const presetDetailId = useUIStore((s) => s.presetDetailId);
  const connectionDetailId = useUIStore((s) => s.connectionDetailId);
  const agentDetailId = useUIStore((s) => s.agentDetailId);
  const toolDetailId = useUIStore((s) => s.toolDetailId);
  const personaDetailId = useUIStore((s) => s.personaDetailId);
  const regexDetailId = useUIStore((s) => s.regexDetailId);
  const botBrowserOpen = useUIStore((s) => s.botBrowserOpen);
  const gameAssetsBrowserOpen = useUIStore((s) => s.gameAssetsBrowserOpen);
  const onboardingTourOpen = useUIStore((s) => s.onboardingTourOpen);
  // Shell interactivity follows the transient optional tour, not the legacy persisted completion flag.
  const hasCompletedOnboarding = !onboardingTourOpen;
  const activeChatId = useChatStore((s) => s.activeChatId);
  const pendingNewChatMode = useChatStore((s) => s.pendingNewChatMode);
  const setupJourneyIntent = useSetupJourneyStore((s) => s.intent);
  useEffect(() => {
    if (!pendingNewChatMode) return;
    const intent = useSetupJourneyStore.getState().intent;
    if (shouldBeginSetupJourney(pendingNewChatMode, intent)) {
      useSetupJourneyStore.getState().begin(pendingNewChatMode);
    }
  }, [pendingNewChatMode]);
  const activeChat = useChatStore((s) => s.activeChat);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const { mutate: clearAutonomousUnread, isPending: isClearingAutonomousUnread } = useClearAutonomousUnread();
  const [trackerPanelTop, setTrackerPanelTop] = useState(TRACKER_PANEL_EDGE_OFFSET);
  const [trackerPanelToggleAnchorY, setTrackerPanelToggleAnchorY] = useState<number | null>(null);
  const lastAutonomousUnreadClearRef = useRef<string | null>(null);

  const syncDekiSessionState = useCallback((state: DekiSessionsState) => {
    setDekiSessions(state.sessions);
    setActiveDekiSessionId(state.activeSessionId);
  }, []);

  const refreshDekiSessions = useCallback(async () => {
    const state = await dekiApi.sessions.list();
    syncDekiSessionState(state);
  }, [syncDekiSessionState]);

  const markDekiSessionsRead = useCallback((sessionIds: readonly string[]) => {
    const ids = new Set(sessionIds.filter(Boolean));
    if (ids.size === 0) return;
    setUnreadDekiSessionIds((current) => {
      if (![...ids].some((sessionId) => current.has(sessionId))) return current;
      const next = new Set(current);
      for (const sessionId of ids) next.delete(sessionId);
      return next;
    });
  }, []);

  const markDekiSessionRead = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return;
      markDekiSessionsRead([sessionId]);
    },
    [markDekiSessionsRead],
  );

  const handleDekiAssistantMessage = useCallback(
    (sessionId: string | null) => {
      if (!sessionId || (dekiOpen && activeDekiSessionId === sessionId)) return;
      setUnreadDekiSessionIds((current) => {
        if (current.has(sessionId)) return current;
        const next = new Set(current);
        next.add(sessionId);
        return next;
      });
    },
    [activeDekiSessionId, dekiOpen],
  );

  useEffect(() => {
    if (dekiOpen) markDekiSessionRead(activeDekiSessionId);
  }, [activeDekiSessionId, dekiOpen, markDekiSessionRead]);

  useEffect(() => {
    let active = true;
    void dekiApi.sessions
      .list()
      .then((state) => {
        if (active) syncDekiSessionState(state);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Deki-senpai chats could not be loaded.";
        toast.error(message);
      });
    return () => {
      active = false;
    };
  }, [syncDekiSessionState]);

  const setLeftSidebarPanel = useCallback((requestedPanel: AppShellLeftSidebarPanel) => {
    setLeftSidebarPanelState(requestedPanel);
  }, []);

  const closeDekiShell = useCallback(() => {
    setDekiOpen(false);
    setLeftSidebarPanelState((current) => (current === "deki" ? null : current));
  }, []);

  const openDekiShell = useCallback(() => {
    useChatStore.getState().setActiveChatId(null);
    useUIStore.getState().closeAllDetails();
    closeRightPanel();
    setLeftSidebarPanel("deki");
    setTrackerPanelOpen(false);
    setDekiOpen(true);
  }, [closeRightPanel, setLeftSidebarPanel, setTrackerPanelOpen]);

  const openDekiSession = useCallback(
    async (sessionId: string) => {
      const selectAction = getDekiSessionSelectAction({
        sessionId,
        activeSessionId: activeDekiSessionId,
        dekiOpen,
        pendingSessionId: pendingDekiSessionIdRef.current,
      });

      if (selectAction === "ignore-pending") return;

      if (selectAction === "open-active") {
        markDekiSessionRead(sessionId);
        openDekiShell();
        return;
      }

      pendingDekiSessionIdRef.current = sessionId;
      try {
        const state = await dekiApi.sessions.select(sessionId);
        syncDekiSessionState(state);
        markDekiSessionRead(sessionId);
        openDekiShell();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Deki-senpai chat could not be opened.";
        toast.error(message);
      } finally {
        if (pendingDekiSessionIdRef.current === sessionId) pendingDekiSessionIdRef.current = null;
      }
    },
    [activeDekiSessionId, dekiOpen, markDekiSessionRead, openDekiShell, syncDekiSessionState],
  );

  const createDekiSession = useCallback(async () => {
    try {
      const state = await dekiApi.sessions.create();
      syncDekiSessionState(state);
      openDekiShell();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deki-senpai chat could not be created.";
      toast.error(message);
    }
  }, [openDekiShell, syncDekiSessionState]);

  const deleteDekiSession = useCallback(
    async (sessionId: string) => {
      try {
        const state = await dekiApi.sessions.delete(sessionId);
        syncDekiSessionState(state);
        markDekiSessionRead(sessionId);
        if (dekiOpen) setDekiOpen(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Deki-senpai chat could not be deleted.";
        toast.error(message);
      }
    },
    [dekiOpen, markDekiSessionRead, syncDekiSessionState],
  );

  const deleteDekiSessions = useCallback(
    async (sessionIds: string[]) => {
      try {
        const state = await dekiApi.sessions.deleteMany(sessionIds);
        syncDekiSessionState(state);
        markDekiSessionsRead(sessionIds);
        if (dekiOpen) setDekiOpen(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Deki-senpai chats could not be deleted.";
        toast.error(message);
      }
    },
    [dekiOpen, markDekiSessionsRead, syncDekiSessionState],
  );

  const openActiveDeki = useCallback(() => {
    openDekiShell();
    markDekiSessionRead(activeDekiSessionId);
    if (!activeDekiSessionId) void refreshDekiSessions();
  }, [activeDekiSessionId, markDekiSessionRead, openDekiShell, refreshDekiSessions]);

  const openNoModelShowcase = useCallback(() => {
    void import("../../features/shell/discovery/showcase")
      .then((module) => module.ensureNoModelGameShowcase())
      .then(({ chatId }) => {
        queryClient.invalidateQueries({ queryKey: chatKeys.all });
        useChatStore.getState().setActiveChatId(chatId);
        useUIStore.getState().closeAllDetails();
        closeRightPanel();
        closeDekiShell();
        setLeftSidebarPanel(null);
        setTrackerPanelOpen(false);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not create the sample world.";
        toast.error(message);
      });
  }, [closeDekiShell, closeRightPanel, queryClient, setLeftSidebarPanel, setTrackerPanelOpen]);

  const closeDiscover = useCallback(() => {
    closeDiscoverHistory(window.history, window.location.href);
    setDiscoverOpen(false);
  }, []);
  const openDiscover = useCallback(() => {
    useUIStore.getState().closeAllDetails();
    closeRightPanel();
    closeDekiShell();
    setTrackerPanelOpen(false);
    setDiscoverOpen(true);
  }, [closeDekiShell, closeRightPanel, setTrackerPanelOpen]);

  useEffect(() => {
    if (!activeChatId) return;
    closeDekiShell();
  }, [activeChatId, closeDekiShell]);

  const openHelpHub = useCallback(() => {
    useUIStore.getState().openRightPanel("help");
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "?") return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) return;
      event.preventDefault();
      useUIStore.getState().openRightPanel("help");
    };
    const handleHelpRequest = () => useUIStore.getState().openRightPanel("help");
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(HELP_REQUEST_EVENT, handleHelpRequest);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(HELP_REQUEST_EVENT, handleHelpRequest);
    };
  }, []);

  useEffect(() => {
    const handleDiscoveryAction = (event: Event) => {
      const detail = (event as CustomEvent<DiscoveryAppEventDetail>).detail;
      if (detail && discoveryActionReplacesCenterSurface(detail.type)) closeDiscover();
      if (detail?.type === "open-deki") {
        useChatStore.getState().setActiveChatId(null);
        useUIStore.getState().closeAllDetails();
        closeRightPanel();
        setLeftSidebarPanel("deki");
        setTrackerPanelOpen(false);
        setDekiOpen(true);
        return;
      }

      if (detail?.type === "open-help") {
        useUIStore.getState().openRightPanel("help");
        return;
      }

      if (detail?.type === "open-discover") {
        openDiscover();
        return;
      }

      if (detail?.type === "go-home") {
        closeDekiShell();
        setLeftSidebarPanel(null);
        setTrackerPanelOpen(false);
        return;
      }

      if (detail?.type === "open-mode-setup") {
        useSetupJourneyStore.getState().begin(detail.mode);
        useChatStore.getState().setPendingNewChatMode(detail.mode);
        return;
      }

      if (detail?.type === "open-chat-list") {
        closeDekiShell();
        closeRightPanel();
        setActiveChatSidebarTab("conversation");
        setLeftSidebarPanel("chats");
        return;
      }

      if (detail?.type === "show-active-chat") {
        closeDekiShell();
        closeRightPanel();
        return;
      }

      if (detail?.type === "open-chat-destination") {
        closeDekiShell();
        closeRightPanel();
        if (detail.destination === "prompt-inspector") {
          toast.info("Choose Peek Prompt on an assistant message to inspect its prompt.");
        } else if (detail.destination === "message-actions") {
          toast.info("Hover or tap a message to reveal its message actions.");
        }
        return;
      }

      if (detail?.type === "open-showcase") {
        openNoModelShowcase();
      }
    };

    window.addEventListener(DISCOVERY_APP_EVENT, handleDiscoveryAction);
    return () => window.removeEventListener(DISCOVERY_APP_EVENT, handleDiscoveryAction);
  }, [
    closeDekiShell,
    closeDiscover,
    closeRightPanel,
    openDiscover,
    openNoModelShowcase,
    setLeftSidebarPanel,
    setTrackerPanelOpen,
  ]);

  const closeDiscoverFromHistory = useCallback(() => setDiscoverOpen(false), []);
  useDiscoverHistoryLifecycle(discoverOpen, closeDiscoverFromHistory);

  useEffect(() => {
    if (!activeChatId || isClearingAutonomousUnread) return;
    const metadata = parseChatMetadata(activeChat?.metadata);
    const unreadCount = typeof metadata.autonomousUnreadCount === "number" ? metadata.autonomousUnreadCount : 0;
    const persistedUnread = unreadCount > 0;
    if (!persistedUnread && !useChatStore.getState().unreadCounts.has(activeChatId)) return;
    const clearKey = `${activeChatId}:${unreadCount}:${metadata.autonomousUnreadAt ?? ""}`;
    if (lastAutonomousUnreadClearRef.current === clearKey) return;
    clearUnread(activeChatId);
    clearAutonomousUnread(activeChatId, {
      onSuccess: () => {
        lastAutonomousUnreadClearRef.current = clearKey;
      },
    });
  }, [activeChat?.metadata, activeChatId, clearAutonomousUnread, clearUnread, isClearingAutonomousUnread]);

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      sidebarDragWidthRef.current = sharedPanelWidth;
      setSidebarDragWidth(sharedPanelWidth);
      if (rightPanelOpen) setRightPanelResizing(true);

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampWidth(moveEvent.clientX, SHARED_PANEL_WIDTH_MIN, SHARED_PANEL_WIDTH_MAX);
        sidebarDragWidthRef.current = nextWidth;
        setSidebarDragWidth(nextWidth);
      };
      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        const nextWidth = sidebarDragWidthRef.current ?? sharedPanelWidth;
        setSidebarWidth(nextWidth);
        setRightPanelWidth(nextWidth);
        sidebarDragWidthRef.current = null;
        setSidebarDragWidth(null);
        if (rightPanelOpen) setRightPanelResizing(false);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [isMobile, rightPanelOpen, setRightPanelResizing, setRightPanelWidth, setSidebarWidth, sharedPanelWidth],
  );

  const startRightPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      rightPanelDragWidthRef.current = sharedPanelWidth;
      setRightPanelDragWidth(sharedPanelWidth);
      setRightPanelResizing(true);

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampWidth(
          window.innerWidth - moveEvent.clientX,
          SHARED_PANEL_WIDTH_MIN,
          SHARED_PANEL_WIDTH_MAX,
        );
        rightPanelDragWidthRef.current = nextWidth;
        setRightPanelDragWidth(nextWidth);
      };
      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        const nextWidth = rightPanelDragWidthRef.current ?? sharedPanelWidth;
        setSidebarWidth(nextWidth);
        setRightPanelWidth(nextWidth);
        rightPanelDragWidthRef.current = null;
        setRightPanelDragWidth(null);
        setRightPanelResizing(false);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [isMobile, setRightPanelResizing, setRightPanelWidth, setSidebarWidth, sharedPanelWidth],
  );

  const adjustSidebarWidth = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
      let nextWidth = sharedPanelWidth;

      if (event.key === "ArrowLeft") nextWidth = sharedPanelWidth - step;
      else if (event.key === "ArrowRight") nextWidth = sharedPanelWidth + step;
      else if (event.key === "Home") nextWidth = SHARED_PANEL_WIDTH_MIN;
      else if (event.key === "End") nextWidth = SHARED_PANEL_WIDTH_MAX;
      else return;

      event.preventDefault();
      const clampedWidth = clampWidth(nextWidth, SHARED_PANEL_WIDTH_MIN, SHARED_PANEL_WIDTH_MAX);
      setSidebarWidth(clampedWidth);
      setRightPanelWidth(clampedWidth);
    },
    [setRightPanelWidth, setSidebarWidth, sharedPanelWidth],
  );

  const adjustRightPanelWidth = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
      let nextWidth = sharedPanelWidth;

      if (event.key === "ArrowLeft") nextWidth = sharedPanelWidth + step;
      else if (event.key === "ArrowRight") nextWidth = sharedPanelWidth - step;
      else if (event.key === "Home") nextWidth = SHARED_PANEL_WIDTH_MIN;
      else if (event.key === "End") nextWidth = SHARED_PANEL_WIDTH_MAX;
      else return;

      event.preventDefault();
      const clampedWidth = clampWidth(nextWidth, SHARED_PANEL_WIDTH_MIN, SHARED_PANEL_WIDTH_MAX);
      setSidebarWidth(clampedWidth);
      setRightPanelWidth(clampedWidth);
    },
    [setRightPanelWidth, setSidebarWidth, sharedPanelWidth],
  );

  const detailView = getDetailRouteView({
    characterDetailId,
    characterLibraryOpen,
    lorebookDetailId,
    presetDetailId,
    connectionDetailId,
    agentDetailId,
    toolDetailId,
    personaDetailId,
    regexDetailId,
  });

  const showAmbientDecor = !activeChatId && !detailView && !botBrowserOpen && !gameAssetsBrowserOpen && !dekiOpen;
  const hasDetailView = detailView != null;
  const { discoverSurfaceVisible, dekiSurfaceVisible, mainSurfaceVisible } = getAppShellCenterSurfaceState({
    botBrowserOpen,
    gameAssetsBrowserOpen,
    rightPanelOpen,
    detailViewOpen: hasDetailView,
    dekiOpen,
    activeDekiSessionId,
    discoverOpen,
  });
  const setupJourneyHost = getSetupJourneyHost({
    activeChatId,
    detailViewOpen: hasDetailView,
    mainSurfaceVisible,
  });
  useEffect(() => {
    if (hasDetailView) setDekiOpen(false);
  }, [hasDetailView]);
  const trackerPanelModeAvailable = isTrackerPanelAvailableForChatMode(activeChat?.mode);
  const trackerPanelActive = trackerPanelModeAvailable && trackerPanelEnabled && trackerPanelOpen;
  const trackerPanelSurfaceAvailable = trackerPanelModeAvailable && mainSurfaceVisible && !hasDetailView;
  const trackerPanelVisible = trackerPanelActive && trackerPanelSurfaceAvailable;

  const trackerPanelAnchoredForMotion = trackerPanelVisible;
  const trackerPanelDockToEdge = trackerPanelVisible && trackerPanelHideHudWidgets;
  const updateTrackerPanelToggleAnchor = useCallback(() => {
    const root = mainRef.current;
    const toggle =
      root?.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR) ??
      document.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR);
    if (!toggle) return;
    const rect = toggle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || window.getComputedStyle(toggle).display === "none") return;

    const nextCenterY = rect.top + rect.height / 2;
    setTrackerPanelToggleAnchorY((current) =>
      current !== null && Math.abs(current - nextCenterY) < 0.5 ? current : nextCenterY,
    );
  }, []);
  const updateTrackerPanelTop = useCallback(() => {
    const root = mainRef.current;
    if (trackerPanelDockToEdge) {
      const topBar =
        root?.querySelector<HTMLElement>(TOP_BAR_SELECTOR) ?? document.querySelector<HTMLElement>(TOP_BAR_SELECTOR);
      const rect = topBar?.getBoundingClientRect();
      const nextTop =
        rect && rect.height > 0
          ? Math.max(TRACKER_PANEL_EDGE_OFFSET, Math.ceil(rect.bottom))
          : TRACKER_PANEL_EDGE_OFFSET;
      setTrackerPanelTop((current) => (current === nextTop ? current : nextTop));
      return;
    }
    const anchors = Array.from((root ?? document).querySelectorAll<HTMLElement>(TRACKER_PANEL_ANCHOR_SELECTOR));
    const visibleAnchor = anchors.find((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(anchor).display !== "none";
    });
    const nextTop = visibleAnchor
      ? Math.max(
          TRACKER_PANEL_EDGE_OFFSET,
          Math.ceil(visibleAnchor.getBoundingClientRect().bottom + TRACKER_PANEL_HUD_GAP),
        )
      : TRACKER_PANEL_EDGE_OFFSET;
    setTrackerPanelTop((current) => (current === nextTop ? current : nextTop));
  }, [trackerPanelDockToEdge]);

  useLayoutEffect(() => {
    if (isMobile || trackerPanelVisible || !trackerPanelSurfaceAvailable) return;

    let frame = 0;
    let discoveryObserver: MutationObserver | null = null;
    let observedToggle: HTMLElement | null = null;
    const observer = new ResizeObserver(() => scheduleUpdate());
    const observeToggle = () => {
      const root = mainRef.current;
      const toggle =
        root?.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR) ??
        document.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR);
      if (!toggle) return false;
      if (observedToggle !== toggle) {
        if (observedToggle) observer.unobserve(observedToggle);
        observer.observe(toggle);
        observedToggle = toggle;
      }
      return true;
    };
    function scheduleUpdate() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const foundToggle = observeToggle();
        updateTrackerPanelToggleAnchor();
        if (foundToggle) {
          discoveryObserver?.disconnect();
          discoveryObserver = null;
        }
      });
    }

    scheduleUpdate();
    if (mainRef.current) {
      discoveryObserver = new MutationObserver(() => scheduleUpdate());
      discoveryObserver.observe(mainRef.current, { childList: true, subtree: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      discoveryObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    activeChat?.mode,
    activeChatId,
    botBrowserOpen,
    gameAssetsBrowserOpen,
    centerCompact,
    isMobile,
    trackerPanelSurfaceAvailable,
    trackerPanelVisible,
    updateTrackerPanelToggleAnchor,
  ]);

  useLayoutEffect(() => {
    if (isMobile || !trackerPanelAnchoredForMotion || !trackerPanelSurfaceAvailable) {
      setTrackerPanelTop(TRACKER_PANEL_EDGE_OFFSET);
      return;
    }

    let frame = 0;
    let discoveryObserver: MutationObserver | null = null;
    const observedTargets = new Set<HTMLElement>();
    const observer = new ResizeObserver(() => {
      scheduleUpdate();
    });
    const observeTargets = () => {
      const selector = trackerPanelDockToEdge ? TOP_BAR_SELECTOR : TRACKER_PANEL_ANCHOR_SELECTOR;
      const targets = Array.from((mainRef.current ?? document).querySelectorAll<HTMLElement>(selector));
      targets.forEach((target) => {
        if (observedTargets.has(target)) return;
        observer.observe(target);
        observedTargets.add(target);
      });
      return targets.length > 0;
    };
    function scheduleUpdate() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const foundTargets = observeTargets();
        updateTrackerPanelTop();
        if (foundTargets) {
          discoveryObserver?.disconnect();
          discoveryObserver = null;
        }
      });
    }

    scheduleUpdate();
    if (mainRef.current) {
      discoveryObserver = new MutationObserver(() => scheduleUpdate());
      discoveryObserver.observe(mainRef.current, { childList: true, subtree: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      discoveryObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    activeChat?.mode,
    activeChatId,
    botBrowserOpen,
    gameAssetsBrowserOpen,
    centerCompact,
    isMobile,
    trackerPanelAnchoredForMotion,
    trackerPanelDockToEdge,
    trackerPanelSurfaceAvailable,
    updateTrackerPanelTop,
  ]);

  const trackerPanelChatAvoidance =
    trackerPanelAnchoredForMotion && trackerPanelSurfaceAvailable
      ? isMobile
        ? "var(--tracker-panel-mobile-width)"
        : `${Math.round(trackerPanelWidth * 0.62)}px`
      : "0px";
  const trackerPanelScrollAvoidance =
    trackerPanelAnchoredForMotion && trackerPanelSurfaceAvailable
      ? isMobile
        ? "var(--tracker-panel-mobile-width)"
        : `${trackerPanelWidth + TRACKER_PANEL_HUD_GAP}px`
      : "0px";
  const trackerPanelHudClearance =
    trackerPanelAnchoredForMotion && trackerPanelHideHudWidgets && trackerPanelSurfaceAvailable
      ? isMobile
        ? "var(--tracker-panel-mobile-width)"
        : `${trackerPanelWidth + TRACKER_PANEL_HUD_GAP}px`
      : "0px";
  const [mobileToolsSheetOpen, setMobileToolsSheetOpen] = useState(false);

  useEffect(() => {
    if (activeChatId !== null) setMobileToolsSheetOpen(false);
  }, [activeChatId]);

  const activeMobilePanel = isMobile
    ? rightPanelOpen
      ? "right"
      : trackerPanelVisible
        ? "tracker"
        : mobileToolsSheetOpen
          ? "tools"
          : dekiSidebarVisible
            ? "deki"
            : chatSidebarVisible
              ? "sidebar"
              : null
    : null;
  const activeMobileOverlayPanel = activeMobilePanel;

  useLayoutEffect(() => {
    return watchVisualViewportHeightVar(document.documentElement, window);
  }, []);

  const closeActiveMobilePanel = useCallback(() => {
    if (activeMobilePanel === "right") closeRightPanel();
    else if (activeMobilePanel === "tracker") setTrackerPanelOpen(false);
    else if (activeMobilePanel === "sidebar" || activeMobilePanel === "deki") setLeftSidebarPanel(null);
    else if (activeMobilePanel === "tools") setMobileToolsSheetOpen(false);
  }, [activeMobilePanel, closeRightPanel, setLeftSidebarPanel, setTrackerPanelOpen]);

  useEffect(() => {
    if (!hasCompletedOnboarding || !isMobile) return;

    const handlePopState = () => {
      if (!mobilePanelHistoryTokenRef.current || !activeMobilePanel) return;
      closingMobilePanelFromPopRef.current = true;
      mobilePanelHistoryTokenRef.current = null;
      closeActiveMobilePanel();
      window.setTimeout(() => {
        closingMobilePanelFromPopRef.current = false;
      }, 0);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeMobilePanel, closeActiveMobilePanel, hasCompletedOnboarding, isMobile]);

  useEffect(() => {
    if (!hasCompletedOnboarding || !isMobile) {
      mobilePanelHistoryTokenRef.current = null;
      return;
    }

    if (activeMobilePanel && !mobilePanelHistoryTokenRef.current) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mobilePanelHistoryTokenRef.current = token;
      window.history.pushState(
        { ...getHistoryStateRecord(), [MOBILE_PANEL_HISTORY_KEY]: token },
        "",
        window.location.href,
      );
      return;
    }

    if (!activeMobilePanel && mobilePanelHistoryTokenRef.current && !closingMobilePanelFromPopRef.current) {
      const token = mobilePanelHistoryTokenRef.current;
      mobilePanelHistoryTokenRef.current = null;
      if (isMobilePanelHistoryState(window.history.state, token)) {
        window.history.back();
      }
    }
  }, [activeMobilePanel, hasCompletedOnboarding, isMobile]);

  const syncMobilePanelInert = useCallback(() => {
    if (!isMobile) {
      setInert(sidebarPanelRef.current, false);
      setInert(dekiSidebarPanelRef.current, false);
      setInert(mobileTrackerPanelRef.current, false);
      setInert(mobileRightPanelRef.current, false);
      setInert(mobileToolsPanelRef.current, false);
      setInert(headerRef.current, false);
      setInert(mainRef.current, false);
      return;
    }

    setInert(sidebarPanelRef.current, activeMobilePanel !== "sidebar");
    setInert(dekiSidebarPanelRef.current, activeMobilePanel !== "deki");
    setInert(mobileTrackerPanelRef.current, activeMobilePanel !== "tracker");
    setInert(mobileRightPanelRef.current, activeMobilePanel !== "right");
    setInert(mobileToolsPanelRef.current, activeMobilePanel !== "tools");
    setInert(headerRef.current, activeMobileOverlayPanel !== null);
    setInert(mainRef.current, activeMobileOverlayPanel !== null);
  }, [activeMobileOverlayPanel, activeMobilePanel, isMobile]);

  useEffect(() => {
    if (!hasCompletedOnboarding) return;
    const sidebarPanel = sidebarPanelRef.current;
    const dekiSidebarPanel = dekiSidebarPanelRef.current;
    const mobileTrackerPanel = mobileTrackerPanelRef.current;
    const mobileRightPanel = mobileRightPanelRef.current;
    const mobileToolsPanel = mobileToolsPanelRef.current;
    const header = headerRef.current;
    const main = mainRef.current;

    syncMobilePanelInert();
    return () => {
      setInert(sidebarPanel, false);
      setInert(dekiSidebarPanel, false);
      setInert(mobileTrackerPanel, false);
      setInert(mobileRightPanel, false);
      setInert(mobileToolsPanel, false);
      setInert(header, false);
      setInert(main, false);
    };
  }, [hasCompletedOnboarding, syncMobilePanelInert]);

  useEffect(() => {
    if (!hasCompletedOnboarding || !isMobile || !activeMobileOverlayPanel) return;

    const getPanel = () => {
      if (activeMobileOverlayPanel === "right") return mobileRightPanelRef.current;
      if (activeMobileOverlayPanel === "tracker") return mobileTrackerPanelRef.current;
      if (activeMobileOverlayPanel === "tools") return mobileToolsPanelRef.current;
      if (activeMobileOverlayPanel === "deki") return dekiSidebarPanelRef.current;
      return sidebarPanelRef.current;
    };

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lastFocusedBeforeMobilePanelRef.current = previousFocus;

    const focusPanel = () => {
      const panel = getPanel();
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      const [firstFocusable] = getFocusableElements(panel);
      (firstFocusable ?? panel).focus();
    };

    const frame = window.requestAnimationFrame(focusPanel);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = getPanel();
      if (!panel) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveMobilePanel();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const previous = lastFocusedBeforeMobilePanelRef.current;
      if (previous?.isConnected && document.activeElement === document.body) {
        previous.focus();
      }
    };
  }, [activeMobileOverlayPanel, closeActiveMobilePanel, hasCompletedOnboarding, isMobile]);

  const trackerPanelDesktop = (side: "left" | "right") =>
    trackerPanelVisible && trackerPanelSide === side ? (
      <aside
        key={`tracker-${side}`}
        data-component={`TrackerDataSidebarDesktop.${side}`}
        data-tracker-size-profile={trackerPanelSizeProfile}
        aria-label="Tracker data panel"
        className={cn(
          "mari-tracker-panel fixed z-30 hidden overflow-hidden bg-[var(--background)]/20 shadow-2xl ring-1 ring-[var(--border)]/35 backdrop-blur-2xl transition-[width,transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity] md:block",
          side === "left" ? "rounded-r-xl" : "rounded-l-xl",
        )}
        style={{
          top: trackerPanelTop,
          maxHeight: `calc(100vh - ${trackerPanelTop + TRACKER_PANEL_EDGE_OFFSET}px)`,
          width: trackerPanelWidth,
          transformOrigin: `${side === "left" ? "left" : "right"} ${Math.max(
            -56,
            Math.min(56, (trackerPanelToggleAnchorY ?? trackerPanelTop) - trackerPanelTop),
          )}px`,
          ...(side === "left"
            ? { left: leftSidebarPanel !== null ? liveSidebarWidth + RESIZER_HITBOX : 0 }
            : { right: rightPanelOpen ? liveRightPanelWidth + RESIZER_HITBOX : 0 }),
        }}
      >
        <div className="mari-tracker-panel-scroll max-h-[inherit] overflow-x-hidden overflow-y-auto">
          <Suspense fallback={<SidePanelFallback />}>
            <TrackerDataSidebar />
          </Suspense>
        </div>
      </aside>
    ) : null;

  return (
    <TopBarActionsProvider>
      <div
        data-component="AppShell"
        className={cn(
          "mari-app fixed left-0 right-0 top-0 flex h-[var(--mari-visual-viewport-height,100dvh)] flex-col overflow-hidden bg-[var(--background)]",
          lowPowerShellMode && "mari-low-power-shell",
          showAmbientDecor && !lowPowerShellMode && "retro-scanlines noise-bg geometric-grid",
        )}
      >
        {/* Y2K decorative stars */}
        {backgroundAutonomousPollingReady && (
          <Suspense fallback={null}>
            <BackgroundAutonomousPollingHost />
          </Suspense>
        )}
        {showAmbientDecor && !lowPowerShellMode && (
          <>
            <div className="y2k-star hidden md:block" style={{ top: "10%", left: "5%", animationDelay: "0s" }} />
            <div className="y2k-star-md hidden md:block" style={{ top: "25%", right: "8%", animationDelay: "1.5s" }} />
            <div className="y2k-star-lg hidden md:block" style={{ top: "60%", left: "3%", animationDelay: "3s" }} />
            <div className="y2k-star hidden md:block" style={{ top: "80%", right: "12%", animationDelay: "0.8s" }} />
            <div className="y2k-star-md hidden md:block" style={{ top: "45%", left: "50%", animationDelay: "2.2s" }} />
          </>
        )}
        <ImagePromptReviewHost />
        <AppFindOverlay />

        <header
          ref={headerRef}
          data-component="AppChrome"
          aria-hidden={activeMobileOverlayPanel ? true : undefined}
          className="mari-app-chrome relative z-40 flex shrink-0 flex-col overflow-visible"
        >
          <WindowTitleBar
            dekiOpen={dekiOpen}
            webMode={botBrowserOpen}
            leftSidebarPanel={leftSidebarPanel}
            onLeftSidebarPanelChange={setLeftSidebarPanel}
            onOpenDeki={() => openActiveDeki()}
            onGoHome={closeDekiShell}
            titlebarAccessory={
              musicDjMiniPlayerEnabled ? (
                <Suspense fallback={null}>
                  <MusicToolbarPlayer />
                </Suspense>
              ) : null
            }
          />
          <TopBar
            dekiOpen={dekiOpen}
            onOpenDeki={() => openActiveDeki()}
            onOpenHelp={openHelpHub}
            onGoHome={closeDekiShell}
            onCloseLeftSidebar={() => setLeftSidebarPanel(null)}
          />
          {!activeChatId && (
            <div className="mari-mobile-homebar relative z-30 flex h-[3.25rem] shrink-0 items-center justify-end px-2 md:hidden">
              <button
                type="button"
                onClick={openHelpHub}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--muted-foreground)] transition-all active:scale-90 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                title="Help"
                aria-label="Help"
              >
                <HelpCircle size="1.05rem" aria-hidden />
              </button>
            </div>
          )}
        </header>

        <div data-component="AppShellBody" className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Mobile sidebar backdrop */}
          {isMobile && leftSidebarPanel !== null && (
            <div
              className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setLeftSidebarPanel(null)}
            />
          )}
          {/* Left sidebar - Chat list */}
          <aside
            ref={sidebarPanelRef}
            data-tour="sidebar"
            data-component="ChatSidebarPanel"
            aria-label="Chat list"
            aria-hidden={isMobile && !chatSidebarVisible ? true : undefined}
            aria-modal={activeMobilePanel === "sidebar" ? true : undefined}
            role={activeMobilePanel === "sidebar" ? "dialog" : undefined}
            tabIndex={activeMobilePanel === "sidebar" ? -1 : undefined}
            className={cn(
              "mari-sidebar flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl",
              sidebarDragWidth == null && "transition-none",
              // Mobile: fixed overlay
              "max-md:fixed max-md:top-0 max-md:left-0 max-md:z-[70] max-md:shadow-2xl",
              !chatSidebarVisible && "max-md:w-0!",
            )}
            style={{
              width: chatSidebarVisible ? (isMobile ? "min(18.75rem, 85vw)" : liveSidebarWidth) : 0,
              bottom: isMobile && chatSidebarVisible ? "calc(4.5rem + env(safe-area-inset-bottom))" : 0,
            }}
          >
            <div className="h-full" style={{ width: isMobile ? "min(18.75rem, 85vw)" : liveSidebarWidth }}>
              <ChatSidebar activeTab={activeChatSidebarTab} onActiveTabChange={setActiveChatSidebarTab} />
            </div>
          </aside>
          <aside
            ref={dekiSidebarPanelRef}
            data-tour="deki-sidebar"
            data-component="DekiSidebarPanel"
            aria-label="Deki-senpai chats"
            aria-hidden={isMobile && !dekiSidebarVisible ? true : undefined}
            aria-modal={activeMobilePanel === "deki" ? true : undefined}
            role={activeMobilePanel === "deki" ? "dialog" : undefined}
            tabIndex={activeMobilePanel === "deki" ? -1 : undefined}
            className={cn(
              "mari-sidebar flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl",
              sidebarDragWidth == null && "transition-none",
              "max-md:fixed max-md:top-0 max-md:left-0 max-md:z-[70] max-md:shadow-2xl",
              !dekiSidebarVisible && "max-md:w-0!",
            )}
            style={{
              width: dekiSidebarVisible ? (isMobile ? "min(18.75rem, 85vw)" : liveSidebarWidth) : 0,
              bottom: isMobile && dekiSidebarVisible ? "calc(4.5rem + env(safe-area-inset-bottom))" : 0,
            }}
          >
            <div className="h-full" style={{ width: isMobile ? "min(18.75rem, 85vw)" : liveSidebarWidth }}>
              <DekiSidebar
                sessions={dekiSessions}
                activeSessionId={activeDekiSessionId}
                unreadSessionIds={unreadDekiSessionIds}
                dekiOpen={dekiOpen}
                onOpenSession={(sessionId) => void openDekiSession(sessionId)}
                onCreateSession={() => void createDekiSession()}
                onDeleteSession={(sessionId) => void deleteDekiSession(sessionId)}
                onDeleteSessions={(sessionIds) => void deleteDekiSessions(sessionIds)}
                onClose={() => setLeftSidebarPanel(null)}
              />
            </div>
          </aside>{" "}
          {!isMobile && leftSidebarPanel !== null && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-30 hidden w-px bg-[var(--sidebar-border)]/30 md:block"
                style={{ left: liveSidebarWidth }}
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left sidebar"
                aria-valuemin={SHARED_PANEL_WIDTH_MIN}
                aria-valuemax={SHARED_PANEL_WIDTH_MAX}
                aria-valuenow={Math.round(liveSidebarWidth)}
                tabIndex={0}
                onMouseDown={startSidebarResize}
                onKeyDown={adjustSidebarWidth}
                className="absolute inset-y-0 z-20 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 focus-visible:bg-[var(--primary)]/40 focus-visible:outline-none md:block"
                style={{ left: liveSidebarWidth }}
              />
            </>
          )}
          {!isMobile && trackerPanelSurfaceAvailable && trackerPanelDesktop("left")}
          {/* Center content */}
          <main
            ref={mainRef}
            data-tour="chat-area"
            data-component="CenterContent"
            aria-label="Main content"
            aria-hidden={activeMobileOverlayPanel ? true : undefined}
            className={cn(
              "@container mari-main relative flex min-w-0 flex-1 flex-col overflow-hidden",
              isMobile && !activeChatId && "pb-14 pt-3",
            )}
          >
            <div className="relative flex flex-1 flex-col overflow-hidden">
              {/* Bot Browser - kept mounted once opened so state persists across close/reopen */}
              <MountOnceWhenOpened open={botBrowserOpen} overlay>
                <BotBrowserView />
              </MountOnceWhenOpened>
              {/* Game Assets Browser - kept mounted once opened so state persists across close/reopen */}
              <MountOnceWhenOpened open={gameAssetsBrowserOpen} overlay>
                <GameAssetsBrowserView />
              </MountOnceWhenOpened>
              <MountOnceWhenOpened open={dekiSurfaceVisible} overlay hideOverlayWhenClosed slideFromBottom={isMobile}>
                <DekiSurface
                  sessionId={activeDekiSessionId}
                  onCreateSession={createDekiSession}
                  onSessionsChanged={refreshDekiSessions}
                  onAssistantMessagePersisted={() => handleDekiAssistantMessage(activeDekiSessionId)}
                />
              </MountOnceWhenOpened>
              <MountOnceWhenOpened
                open={discoverSurfaceVisible}
                overlay
                hideOverlayWhenClosed
                slideFromBottom={isMobile}
              >
                <Suspense fallback={<ShellLoadingFallback compact />}>
                  <DiscoverPanel onClose={closeDiscover} />
                </Suspense>
              </MountOnceWhenOpened>
              <div
                className={mainSurfaceVisible ? "flex flex-1 flex-col overflow-hidden" : "hidden"}
                style={
                  {
                    "--tracker-panel-mobile-width": mobileTrackerPanelWidth,
                    "--tracker-chat-avoid-left": trackerPanelSide === "left" ? trackerPanelChatAvoidance : "0px",
                    "--tracker-chat-avoid-right": trackerPanelSide === "right" ? trackerPanelChatAvoidance : "0px",
                    "--tracker-chat-scroll-avoid-left":
                      trackerPanelSide === "left" ? trackerPanelScrollAvoidance : "0px",
                    "--tracker-chat-scroll-avoid-right":
                      trackerPanelSide === "right" ? trackerPanelScrollAvoidance : "0px",
                    "--tracker-panel-hud-clear-left": trackerPanelSide === "left" ? trackerPanelHudClearance : "0px",
                    "--tracker-panel-hud-clear-right": trackerPanelSide === "right" ? trackerPanelHudClearance : "0px",
                  } as CSSProperties
                }
              >
                <Suspense fallback={<MainPaneFallback />}>
                  {detailView ?? (
                    <ModeSurface
                      readinessSurface={
                        setupJourneyHost === "home" ? (
                          <Suspense fallback={null}>
                            <SetupReadinessJourney />
                          </Suspense>
                        ) : null
                      }
                      onOpenDiscover={openDiscover}
                      onOpenNoModelShowcase={openNoModelShowcase}
                    />
                  )}
                </Suspense>
              </div>
              {setupJourneyHost === "shell" && setupJourneyIntent && !setupJourneyIntent.completed && (
                <div className="absolute inset-0 z-[90] overflow-y-auto bg-[var(--background)]/90 p-4 backdrop-blur-sm sm:p-8">
                  <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl sm:p-5">
                    <Suspense fallback={<ShellLoadingFallback compact />}>
                      <SetupReadinessJourney />
                    </Suspense>
                  </div>
                </div>
              )}
            </div>
            {/* Floating avatar notification bubbles (right edge) */}
            {notificationBubblesMounted && (
              <Suspense fallback={null}>
                <ChatNotificationBubbles />
              </Suspense>
            )}
          </main>
          {!isMobile && trackerPanelSurfaceAvailable && trackerPanelDesktop("right")}
          {/* Mobile tracker panel */}
          {isMobile && trackerPanelVisible && (
            <aside
              ref={mobileTrackerPanelRef}
              data-component="TrackerDataSidebarMobile"
              aria-label="Tracker data panel"
              role="dialog"
              aria-modal="true"
              className={cn(
                "mari-tracker-panel fixed! top-0 z-[70] overflow-y-auto bg-[var(--background)]/65 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                trackerPanelSide === "left" ? "left-0" : "right-0",
              )}
              style={{
                width: mobileTrackerPanelWidth,
                paddingTop: "calc(3.25rem + env(safe-area-inset-top))",
                bottom: "calc(3.5rem + env(safe-area-inset-bottom))",
              }}
            >
              <Suspense fallback={<SidePanelFallback />}>
                <TrackerDataSidebar fillHeight />
              </Suspense>
            </aside>
          )}
          {/* Mobile tracker panel backdrop */}
          {isMobile && trackerPanelVisible && (
            <div
              className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setTrackerPanelOpen(false)}
            />
          )}
          {/* Mobile right panel backdrop */}
          {isMobile && rightPanelOpen && (
            <div
              className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => closeRightPanel()}
            />
          )}
          {/* Right panel - Context / Settings */}
          {isMobile ? (
            rightPanelOpen && (
              <aside
                ref={mobileRightPanelRef}
                data-component="RightPanelMobile"
                aria-label="Settings and tools panel"
                aria-modal="true"
                role="dialog"
                tabIndex={-1}
                className="mari-right-panel fixed! top-0 right-0 z-[70] w-full! shadow-2xl overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
              >
                <Suspense fallback={<SidePanelFallback />}>
                  <RightPanel />
                </Suspense>
              </aside>
            )
          ) : (
            <aside
              data-component="RightPanelDesktop"
              aria-label="Settings and tools panel"
              className={cn(
                "mari-right-panel flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl",
                rightPanelDragWidth == null && "transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              )}
              style={{ width: rightPanelOpen ? liveRightPanelWidth : 0 }}
            >
              {rightPanelOpen && (
                <div className="h-full" style={{ width: liveRightPanelWidth }}>
                  <Suspense fallback={<SidePanelFallback />}>
                    <RightPanel />
                  </Suspense>
                </div>
              )}
            </aside>
          )}
          {!isMobile && rightPanelOpen && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-30 hidden w-px bg-[var(--sidebar-border)]/30 md:block"
                style={{ right: liveRightPanelWidth }}
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right sidebar"
                aria-valuemin={SHARED_PANEL_WIDTH_MIN}
                aria-valuemax={SHARED_PANEL_WIDTH_MAX}
                aria-valuenow={Math.round(liveRightPanelWidth)}
                tabIndex={0}
                onMouseDown={startRightPanelResize}
                onKeyDown={adjustRightPanelWidth}
                className="absolute inset-y-0 z-20 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 focus-visible:bg-[var(--primary)]/40 focus-visible:outline-none md:block"
                style={{ right: liveRightPanelWidth }}
              />
            </>
          )}
          {/* First-time onboarding tutorial */}
          {onboardingTourOpen && (
            <Suspense fallback={null}>
              <OnboardingTutorial onShellInertResync={syncMobilePanelInert} />
            </Suspense>
          )}
          {debugMode && hasAgentDebugActivity && (
            <Suspense fallback={null}>
              <AgentDebugPanel />
            </Suspense>
          )}
          {musicDjMiniPlayerEnabled && (
            <Suspense fallback={null}>
              <MusicFloatingWidget />
            </Suspense>
          )}
        </div>
      </div>
      <MobileTabBar
        dekiOpen={dekiOpen}
        leftSidebarPanel={leftSidebarPanel}
        toolsSheetOpen={mobileToolsSheetOpen}
        toolsSheetRef={mobileToolsPanelRef}
        trackerPanelVisible={trackerPanelVisible}
        onToolsSheetOpenChange={setMobileToolsSheetOpen}
        onLeftSidebarPanelChange={setLeftSidebarPanel}
        onToggleDeki={() => setDekiOpen((v) => !v)}
        onGoHome={() => setDekiOpen(false)}
        onOpenDiscover={openDiscover}
      />
    </TopBarActionsProvider>
  );
}
