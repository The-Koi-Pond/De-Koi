export type AppShellCenterSurfaceInput = {
  botBrowserOpen: boolean;
  gameAssetsBrowserOpen: boolean;
  rightPanelOpen: boolean;
  detailViewOpen: boolean;
  dekiOpen: boolean;
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
}: AppShellCenterSurfaceInput): AppShellCenterSurfaceState {
  const fullViewSurfaceOpen = botBrowserOpen || gameAssetsBrowserOpen;
  const dekiSurfaceVisible = dekiOpen && !fullViewSurfaceOpen && !rightPanelOpen && !detailViewOpen;

  return {
    dekiSurfaceVisible,
    mainSurfaceVisible: !fullViewSurfaceOpen && !dekiSurfaceVisible,
  };
}
