export type AppShellLeftSidebarPanel = "chats" | "deki" | null;

export type AppShellLeftSidebarState = {
  chatSidebarOpen: boolean;
  dekiSidebarOpen: boolean;
};

export function setAppShellLeftSidebarPanel(
  requestedPanel: AppShellLeftSidebarPanel,
  {
    setChatSidebarOpen,
    setPanel,
  }: {
    setChatSidebarOpen: (open: boolean) => void;
    setPanel: (panel: AppShellLeftSidebarPanel) => void;
  },
): void {
  setChatSidebarOpen(requestedPanel === "chats");
  setPanel(requestedPanel);
}

export function getAppShellLeftSidebarState({
  requestedPanel,
}: {
  requestedPanel: AppShellLeftSidebarPanel;
}): AppShellLeftSidebarState {
  return {
    chatSidebarOpen: requestedPanel === "chats",
    dekiSidebarOpen: requestedPanel === "deki",
  };
}

export function getToggledAppShellLeftSidebarPanel(
  currentPanel: AppShellLeftSidebarPanel,
  requestedPanel: Exclude<AppShellLeftSidebarPanel, null>,
): AppShellLeftSidebarPanel {
  return currentPanel === requestedPanel ? null : requestedPanel;
}
