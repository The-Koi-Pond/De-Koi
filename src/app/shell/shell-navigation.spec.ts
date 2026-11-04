import { describe, expect, it } from "vitest";

import {
  isShellPanelTabOpen,
  LIBRARY_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  SHELL_NAV_ITEMS,
  SHELL_PANEL_BY_DESTINATION,
  SHELL_PANEL_ITEMS,
  TOOLS_NAV_ITEMS,
} from "../../shared/components/shell-navigation";
import { createMobileToolsPanels, TOOLS_PANELS } from "../../shared/components/mobile-shell-actions";

describe("shell navigation registry", () => {
  it("groups every shell destination exactly once with a visible label", () => {
    const grouped = [...PRIMARY_NAV_ITEMS, ...LIBRARY_NAV_ITEMS, ...TOOLS_NAV_ITEMS];

    expect(grouped).toEqual(SHELL_NAV_ITEMS);
    expect(new Set(grouped.map((item) => item.destination)).size).toBe(grouped.length);
    expect(grouped.every((item) => item.label.trim().length > 0)).toBe(true);
  });

  it("keeps the required destinations in their intended groups", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual(["Chats", "Deki-senpai"]);
    expect(LIBRARY_NAV_ITEMS.map((item) => item.label)).toEqual(["Characters", "Lorebooks", "Presets", "Gallery"]);
    expect(TOOLS_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Connections",
      "Agents",
      "Settings",
      "Help",
      "Discover",
    ]);
  });

  it("owns every panel's icon and semantic accent exactly once", () => {
    expect(SHELL_PANEL_ITEMS).toHaveLength(8);
    expect(new Set(SHELL_PANEL_ITEMS.map((item) => item.destination)).size).toBe(SHELL_PANEL_ITEMS.length);
    expect(SHELL_PANEL_ITEMS.every((item) => Boolean(item.icon))).toBe(true);
    expect(SHELL_PANEL_ITEMS.every((item) => ["primary", "accent"].includes(item.accentRole))).toBe(true);
    expect(SHELL_PANEL_ITEMS.every((item) => !("gradient" in item))).toBe(true);
  });

  it("keeps the mobile tools projection exactly aligned with the panel registry", () => {
    expect(TOOLS_PANELS.map((item) => item.panel)).toEqual(SHELL_PANEL_ITEMS.map((item) => item.destination));
    expect(TOOLS_PANELS.every((item) => item.label.trim().length > 0 && Boolean(item.icon))).toBe(true);
  });

  it("shows Personas under the Characters tab instead of as its own menu item", () => {
    expect(SHELL_PANEL_ITEMS.map((item) => item.destination as string)).not.toContain("personas");
    expect(SHELL_PANEL_BY_DESTINATION.personas.label).toBe("Personas");
    expect(isShellPanelTabOpen("characters", "personas", true)).toBe(true);
    expect(isShellPanelTabOpen("characters", "characters", true)).toBe(true);
    expect(isShellPanelTabOpen("characters", "personas", false)).toBe(false);
    expect(isShellPanelTabOpen("lorebooks", "personas", true)).toBe(false);
    expect(isShellPanelTabOpen("lorebooks", "lorebooks", true)).toBe(true);
  });

  it("keeps the Browser panel (Discover links to it) without a menu item of its own", () => {
    expect(SHELL_PANEL_ITEMS.map((item) => item.destination as string)).not.toContain("bot-browser");
    expect(SHELL_PANEL_BY_DESTINATION["bot-browser"].label).toBe("Browser");
  });

  it("fails fast when a non-panel destination reaches the mobile tools projection", () => {
    const discoverItem = SHELL_NAV_ITEMS.find((item) => item.destination === "discover");

    expect(discoverItem).toBeDefined();
    expect(() => createMobileToolsPanels([discoverItem!])).toThrow("Invalid mobile tools panel destination: discover");
  });
});
