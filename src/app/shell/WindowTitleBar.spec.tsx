import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { WindowTitleBar } from "./WindowTitleBar";

const windowControls = vi.hoisted(() => ({
  closeDesktopWindow: vi.fn(() => Promise.resolve()),
  getDesktopWindowVisualState: vi.fn(() => Promise.resolve({ fullscreen: false, maximized: false })),
  hasDesktopWindowControls: vi.fn(() => false),
  minimizeDesktopWindow: vi.fn(() => Promise.resolve()),
  onDesktopWindowVisualStateChanged: vi.fn(() => Promise.resolve(() => {})),
  startDesktopWindowDrag: vi.fn(() => Promise.resolve()),
  toggleDesktopWindowFullscreen: vi.fn(() => Promise.resolve({ fullscreen: true, maximized: false })),
  toggleDesktopWindowMaximize: vi.fn(() => Promise.resolve({ fullscreen: false, maximized: true })),
}));

vi.mock("../../shared/api/window-controls-api", () => windowControls);

function shellActionLabels(root: HTMLElement) {
  const nativeWindowLabels = new Set(["Close window", "Minimize window", "Maximize window", "Restore window"]);
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => label && !nativeWindowLabels.has(label));
}

describe("WindowTitleBar web mode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    useUIStore.setState({
      botBrowserOpen: true,
      sidebarOpen: true,
    });
    windowControls.hasDesktopWindowControls.mockReturnValue(false);
    windowControls.getDesktopWindowVisualState.mockResolvedValue({ fullscreen: false, maximized: false });
    windowControls.onDesktopWindowVisualStateChanged.mockResolvedValue(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    useChatStore.getState().reset();
    useUIStore.getState().closeAllDetails();
    vi.restoreAllMocks();
  });

  it("keeps web and desktop shell actions in the same order while hiding only native window controls", async () => {
    const desktopContainer = document.createElement("div");
    document.body.appendChild(desktopContainer);
    let desktopRoot: Root | null = null;

    windowControls.hasDesktopWindowControls.mockReturnValue(true);
    await act(async () => {
      desktopRoot = createRoot(desktopContainer);
      desktopRoot.render(<WindowTitleBar />);
    });
    const desktopLabels = shellActionLabels(desktopContainer);

    windowControls.hasDesktopWindowControls.mockReturnValue(false);
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar webMode />);
    });

    expect(desktopContainer.querySelector('[aria-label="Window controls"]')).toBeTruthy();
    expect(container!.querySelector('[aria-label="Window controls"]')).toBeNull();
    expect(shellActionLabels(container!)).toEqual(desktopLabels);
    expect(shellActionLabels(container!)).toContain("Deki-senpai");
    expect(container!.querySelector(".mari-titlebar-web-home-button")).toBeNull();

    await act(async () => {
      desktopRoot?.unmount();
    });
    desktopContainer.remove();
  });

  it("keeps the sidebar collapse control available in web mode", async () => {
    const setLeftSidebarPanel = vi.fn();
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar webMode leftSidebarPanel="chats" onLeftSidebarPanelChange={setLeftSidebarPanel} />);
    });

    const sidebarToggle = container!.querySelector<HTMLButtonElement>('[data-tour="sidebar-toggle"]');

    expect(sidebarToggle).toBeTruthy();
    expect(sidebarToggle?.getAttribute("aria-label")).toBe("Close chats");

    await act(async () => {
      sidebarToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(setLeftSidebarPanel).toHaveBeenCalledWith(null);
  });

  it("keeps the Deki sidebar control active only for the left Deki panel", async () => {
    const setLeftSidebarPanel = vi.fn();
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WindowTitleBar dekiOpen webMode leftSidebarPanel="chats" onLeftSidebarPanelChange={setLeftSidebarPanel} />,
      );
    });

    const dekiSidebarToggle = container!.querySelector<HTMLButtonElement>('button[aria-label="Deki-senpai"]');

    expect(dekiSidebarToggle).toBeTruthy();
    expect(dekiSidebarToggle?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      dekiSidebarToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(setLeftSidebarPanel).toHaveBeenCalledWith("deki");
  });

  it("treats browser-hosted shells without desktop controls as web mode", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar />);
    });

    expect(container!.querySelector('[aria-label="Window controls"]')).toBeNull();
    expect(container!.querySelectorAll('button[aria-label="Home"]')).toHaveLength(1);
    expect(container!.querySelector('[aria-label="Deki-senpai"]')).toBeTruthy();
    expect(container!.querySelector(".mari-titlebar-web-home-button")).toBeNull();
  });

  it("uses the house icon for the home action instead of the app logo", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar />);
    });

    const homeButton = container!.querySelector<HTMLButtonElement>('button[aria-label="Home"]');

    expect(homeButton?.querySelector("svg")).toBeTruthy();
    expect(homeButton?.querySelector('img[src="/favicon.png"]')).toBeNull();
    expect(homeButton?.textContent?.trim()).toBe("");
  });

  it("places the titlebar accessory on the left side of the titlebar", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar titlebarAccessory={<div data-testid="music-toolbar">Music DJ</div>} />);
    });

    expect(container!.querySelector(".mari-title-drag-region [data-testid='music-toolbar']")).toBeTruthy();
    expect(container!.querySelector(".mari-window-actions [data-testid='music-toolbar']")).toBeNull();
  });

  it("keeps titlebar navigation labels accessible without visible text", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar onOpenDiscover={vi.fn()} />);
    });
    for (const label of ["Deki-senpai", "Characters", "Connections", "Discover"]) {
      const button = container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(button).toBeTruthy();
      expect(button?.textContent?.trim()).toBe("");
    }
  });
});
