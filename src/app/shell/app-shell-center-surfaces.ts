export type AppShellCenterSurfaceInput = {
  botBrowserOpen: boolean;
  gameAssetsBrowserOpen: boolean;
  rightPanelOpen: boolean;
  detailViewOpen: boolean;
  dekiOpen: boolean;
  activeDekiSessionId: string | null;
};

export type AppShellCenterSurfaceState = {
  dekiSurfaceVisible: boolean;
  mainSurfaceVisible: boolean;
};

export function getAppShellCenterSurfaceState({
  botBrowserOpen,
  gameAssetsBrowserOpen,
  rightPanelOpen,
  detailViewOpen,
  dekiOpen,
  activeDekiSessionId,
}: AppShellCenterSurfaceInput): AppShellCenterSurfaceState {
  const fullViewSurfaceOpen = botBrowserOpen || gameAssetsBrowserOpen;
  const dekiSurfaceVisible =
    Boolean(activeDekiSessionId) && dekiOpen && !fullViewSurfaceOpen && !rightPanelOpen && !detailViewOpen;

  return {
    dekiSurfaceVisible,
    mainSurfaceVisible: !fullViewSurfaceOpen && !dekiSurfaceVisible,
  };
}
