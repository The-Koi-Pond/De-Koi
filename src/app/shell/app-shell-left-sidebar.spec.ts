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

describe("setAppShellLeftSidebarPanel", () => {
  it("synchronizes the shell panel and dependent chat-sidebar flag from one owner", async () => {
    const module = (await import("./app-shell-left-sidebar")) as Record<string, unknown>;
    expect(module).toHaveProperty("setAppShellLeftSidebarPanel");

    const setAppShellLeftSidebarPanel = module.setAppShellLeftSidebarPanel as (
      requestedPanel: "chats" | "deki" | null,
      dependencies: {
        setChatSidebarOpen: (open: boolean) => void;
        setPanel: (panel: "chats" | "deki" | null) => void;
      },
    ) => void;
    const updates: Array<[string, boolean | "chats" | "deki" | null]> = [];
    const dependencies = {
      setChatSidebarOpen: (open: boolean) => updates.push(["chat", open]),
      setPanel: (panel: "chats" | "deki" | null) => updates.push(["panel", panel]),
    };

    setAppShellLeftSidebarPanel("chats", dependencies);
    setAppShellLeftSidebarPanel(null, dependencies);

    expect(updates).toEqual([
      ["chat", true],
      ["panel", "chats"],
      ["chat", false],
      ["panel", null],
    ]);
  });
});
