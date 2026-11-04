import type { Panel } from "../../shared/stores/ui.store";
import type { AppShellLeftSidebarPanel } from "./app-shell-left-sidebar";

export type AppShellSideLayoutInput = {
  /** The Pond theme's desktop layout: the navigation rail with its column on the left. */
  showNavRail: boolean;
  rightPanelOpen: boolean;
  rightPanel: Panel;
  leftSidebarPanel: AppShellLeftSidebarPanel;
};

export type AppShellSideLayout = {
  /** Rail layout: Settings is a drawer over the page, taking no layout width. */
  settingsDrawerOpen: boolean;
  /** Rail layout: a library panel shows in the left column in place of the chat or Deki-senpai list. */
  columnPanelOpen: boolean;
  /** Something takes layout width on the left (the list, or a column panel). */
  leftColumnOpen: boolean;
  /** Something takes layout width on the right: any side panel, or only Help in the rail layout. */
  rightColumnOpen: boolean;
  /**
   * Whether an open side panel swaps Deki-senpai's chat in the page for the main surface. Only outside the rail
   * layout: there, panels open beside the page and it stays as it was.
   */
  pageReplacedBySidePanel: boolean;
};

/** Where the open panels sit, and what they occupy on each side of the page. */
export function getAppShellSideLayout({
  showNavRail,
  rightPanelOpen,
  rightPanel,
  leftSidebarPanel,
}: AppShellSideLayoutInput): AppShellSideLayout {
  const settingsDrawerOpen = showNavRail && rightPanelOpen && rightPanel === "settings";
  // Help (its button is in the status strip's corner) still opens as a panel on the right.
  const columnPanelOpen = showNavRail && rightPanelOpen && !settingsDrawerOpen && rightPanel !== "help";
  return {
    settingsDrawerOpen,
    columnPanelOpen,
    leftColumnOpen: leftSidebarPanel !== null || columnPanelOpen,
    rightColumnOpen: rightPanelOpen && !columnPanelOpen && !settingsDrawerOpen,
    pageReplacedBySidePanel: !showNavRail && rightPanelOpen,
  };
}

/** Narrowest the page may get before a resize closes the open side panel. */
const MIN_PAGE_WIDTH = 400;

/**
 * Whether a narrow window should close the open side panel to give the page room. Counts only what takes layout
 * width: the rail, the left column and the right column. The Settings drawer lies over the page, so closing it frees
 * nothing and it stays open.
 */
export function shouldAutoCloseSidePanel(
  layout: AppShellSideLayout,
  {
    rightPanelOpen,
    windowWidth,
    panelWidth,
    railWidth,
  }: {
    rightPanelOpen: boolean;
    windowWidth: number;
    panelWidth: number;
    railWidth: number;
  },
): boolean {
  if (!rightPanelOpen || layout.settingsDrawerOpen) return false;
  const reserved = railWidth + (layout.leftColumnOpen ? panelWidth : 0) + (layout.rightColumnOpen ? panelWidth : 0);
  return windowWidth - reserved < MIN_PAGE_WIDTH;
}

/** What the rail's column shows, which its "›" tab brings back after the column is folded or emptied. */
export type AppShellColumnContent = { panel: Panel } | { list: "chats" | "deki" };

export function getColumnContent(
  layout: Pick<AppShellSideLayout, "columnPanelOpen">,
  rightPanel: Panel,
  leftSidebarPanel: AppShellLeftSidebarPanel,
): AppShellColumnContent | null {
  if (layout.columnPanelOpen) return { panel: rightPanel };
  return leftSidebarPanel ? { list: leftSidebarPanel } : null;
}
