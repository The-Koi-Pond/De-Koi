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
  const discoverSurfaceVisible = discoverOpen && !fullViewSurfaceOpen && !rightPanelOpen && !detailViewOpen;

  return {
    discoverSurfaceVisible,
    dekiSurfaceVisible,
    mainSurfaceVisible: !fullViewSurfaceOpen && !dekiSurfaceVisible && !discoverSurfaceVisible,
  };
}
