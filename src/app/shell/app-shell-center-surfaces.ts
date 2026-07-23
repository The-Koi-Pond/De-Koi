export type AppShellCenterSurfaceInput = {
  botBrowserOpen: boolean;
  gameAssetsBrowserOpen: boolean;
  rightPanelOpen: boolean;
  detailViewOpen: boolean;
  dekiOpen: boolean;
  activeDekiSessionId: string | null;
  discoverOpen: boolean;
};

export type AppShellCenterSurfaceState = {
  dekiSurfaceVisible: boolean;
  discoverSurfaceVisible: boolean;
  mainSurfaceVisible: boolean;
};

const DISCOVERY_CENTER_REPLACEMENT_ACTIONS = new Set([
  "open-deki",
  "go-home",
  "open-mode-setup",
  "open-chat-list",
  "show-active-chat",
  "open-chat-destination",
  "open-showcase",
]);

export function discoveryActionReplacesCenterSurface(type: string): boolean {
  return DISCOVERY_CENTER_REPLACEMENT_ACTIONS.has(type);
}

export function getSetupJourneyHost({
  activeChatId,
  detailViewOpen,
  mainSurfaceVisible,
}: {
  activeChatId: string | null;
  detailViewOpen: boolean;
  mainSurfaceVisible: boolean;
}): "home" | "shell" {
  return !activeChatId && !detailViewOpen && mainSurfaceVisible ? "home" : "shell";
}

export function shouldBeginSetupJourney(
  pendingMode: "conversation" | "roleplay" | "game" | null,
  intent: { mode: string; completed: boolean } | null,
): boolean {
  return !!pendingMode && (!intent || intent.mode !== pendingMode || intent.completed);
}

export function getAutomaticMemoryCaptureToast(
  enabled: boolean,
  completion: { operation: "created" | "updated"; memory: { content: string } },
): { title: string; description: string; duration: number } | null {
  if (!enabled) return null;
  return {
    title: completion.operation === "created" ? "Memory saved" : "Memory updated",
    description: completion.memory.content,
    duration: 8_000,
  };
}

export function getAppShellCenterSurfaceState({
  botBrowserOpen,
  gameAssetsBrowserOpen,
  rightPanelOpen,
  detailViewOpen,
  dekiOpen,
  activeDekiSessionId,
  discoverOpen,
}: AppShellCenterSurfaceInput): AppShellCenterSurfaceState {
  const fullViewSurfaceOpen = botBrowserOpen || gameAssetsBrowserOpen;
  const dekiSurfaceVisible =
    Boolean(activeDekiSessionId) && dekiOpen && !discoverOpen && !fullViewSurfaceOpen && !rightPanelOpen && !detailViewOpen;
  const discoverSurfaceVisible = discoverOpen && !fullViewSurfaceOpen && !detailViewOpen;

  return {
    discoverSurfaceVisible,
    dekiSurfaceVisible,
    mainSurfaceVisible: !fullViewSurfaceOpen && !dekiSurfaceVisible && !discoverSurfaceVisible,
  };
}
