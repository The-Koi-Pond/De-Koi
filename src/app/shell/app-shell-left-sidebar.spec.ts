import { describe, expect, it } from "vitest";
import { getAppShellLeftSidebarState, getToggledAppShellLeftSidebarPanel } from "./app-shell-left-sidebar";

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

describe("getToggledAppShellLeftSidebarPanel", () => {
  it("closes the requested panel when it is already active", () => {
    expect(getToggledAppShellLeftSidebarPanel("chats", "chats")).toBeNull();
    expect(getToggledAppShellLeftSidebarPanel("deki", "deki")).toBeNull();
  });

  it("switches to the requested panel when another left panel is active", () => {
    expect(getToggledAppShellLeftSidebarPanel("chats", "deki")).toBe("deki");
    expect(getToggledAppShellLeftSidebarPanel(null, "chats")).toBe("chats");
  });
});
