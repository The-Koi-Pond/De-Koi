export type AppShellLeftSidebarPanel = "chats" | "deki" | null;

export type AppShellLeftSidebarState = {
  chatSidebarOpen: boolean;
  dekiSidebarOpen: boolean;
};

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
