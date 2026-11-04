import { describe, expect, it } from "vitest";
import { getAppShellSideLayout, getColumnContent, shouldAutoCloseSidePanel } from "./app-shell-side-layout";

const rail = (rightPanel: Parameters<typeof getAppShellSideLayout>[0]["rightPanel"], open = true) =>
  getAppShellSideLayout({ showNavRail: true, rightPanelOpen: open, rightPanel, leftSidebarPanel: "chats" });

describe("getAppShellSideLayout", () => {
  it("keeps the old layout without the rail: every panel is on the right and replaces Deki-senpai's page", () => {
    for (const rightPanel of ["characters", "settings", "help"] as const) {
      expect(
        getAppShellSideLayout({ showNavRail: false, rightPanelOpen: true, rightPanel, leftSidebarPanel: "chats" }),
      ).toEqual({
        settingsDrawerOpen: false,
        columnPanelOpen: false,
        leftColumnOpen: true,
        rightColumnOpen: true,
        pageReplacedBySidePanel: true,
      });
    }
  });

  it("in the rail layout, only Help takes the right side and no panel replaces the page", () => {
    expect(rail("characters")).toMatchObject({ columnPanelOpen: true, leftColumnOpen: true, rightColumnOpen: false });
    expect(rail("settings")).toMatchObject({
      settingsDrawerOpen: true,
      columnPanelOpen: false,
      rightColumnOpen: false,
    });
    expect(rail("help")).toMatchObject({ columnPanelOpen: false, rightColumnOpen: true });
    for (const rightPanel of ["characters", "settings", "help"] as const) {
      expect(rail(rightPanel).pageReplacedBySidePanel).toBe(false);
    }
  });
});

describe("shouldAutoCloseSidePanel", () => {
  const sizes = { rightPanelOpen: true, panelWidth: 300 };

  it("matches the old rule without the rail: list plus panel against the window", () => {
    const layout = getAppShellSideLayout({
      showNavRail: false,
      rightPanelOpen: true,
      rightPanel: "characters",
      leftSidebarPanel: "chats",
    });
    expect(shouldAutoCloseSidePanel(layout, { ...sizes, windowWidth: 999, railWidth: 0 })).toBe(true);
    expect(shouldAutoCloseSidePanel(layout, { ...sizes, windowWidth: 1000, railWidth: 0 })).toBe(false);
  });

  it("counts a column panel once, in place of the list, plus the rail", () => {
    const layout = rail("characters");
    expect(shouldAutoCloseSidePanel(layout, { ...sizes, windowWidth: 746, railWidth: 46 })).toBe(false);
    expect(shouldAutoCloseSidePanel(layout, { ...sizes, windowWidth: 745, railWidth: 46 })).toBe(true);
  });

  it("never closes the Settings drawer, which lies over the page", () => {
    expect(shouldAutoCloseSidePanel(rail("settings"), { ...sizes, windowWidth: 500, railWidth: 46 })).toBe(false);
  });
});

describe("getColumnContent", () => {
  it("is the panel in the column, else the list, else nothing", () => {
    expect(getColumnContent(rail("characters"), "characters", "chats")).toEqual({ panel: "characters" });
    // Help sits on the right, so the column still shows the list.
    expect(getColumnContent(rail("help"), "help", "deki")).toEqual({ list: "deki" });
    expect(getColumnContent(rail("help", false), "help", null)).toBeNull();
  });
});
