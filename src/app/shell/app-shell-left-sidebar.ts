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

/**
 * On a phone the chat list is a full-screen drawer. With no chats yet it hides the welcome screen and its setup steps,
 * so start a first-run phone session with the drawer closed. Returning users keep the chat list as their home.
 */
export function shouldCloseFirstRunPhoneDrawer({
  isMobile,
  chatCount,
  panel,
}: {
  isMobile: boolean;
  chatCount: number | null;
  panel: AppShellLeftSidebarPanel;
}): boolean {
  return isMobile && chatCount === 0 && panel === "chats";
}
