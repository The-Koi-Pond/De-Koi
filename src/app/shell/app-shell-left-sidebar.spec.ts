import { describe, expect, it } from "vitest";
import { getAppShellLeftSidebarState } from "./app-shell-left-sidebar";

describe("getAppShellLeftSidebarState", () => {
  it("opens the dedicated Deki sidebar without the character chats sidebar", () => {
    expect(getAppShellLeftSidebarState({ requestedPanel: "deki" })).toEqual({
      chatSidebarOpen: false,
      dekiSidebarOpen: true,
    });
  });

  it("opens the character chats sidebar without the Deki sidebar", () => {
    expect(getAppShellLeftSidebarState({ requestedPanel: "chats" })).toEqual({
      chatSidebarOpen: true,
      dekiSidebarOpen: false,
    });
  });

  it("closes both left sidebars when no left panel is requested", () => {
    expect(getAppShellLeftSidebarState({ requestedPanel: null })).toEqual({
      chatSidebarOpen: false,
      dekiSidebarOpen: false,
    });
  });
});
