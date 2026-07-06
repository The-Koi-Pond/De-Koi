import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { WindowTitleBar } from "./WindowTitleBar";

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

  it("hides desktop window controls while showing only the house home action", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar webMode />);
    });

    expect(container!.querySelector('[aria-label="Window controls"]')).toBeNull();
    expect(container!.querySelector(".mari-titlebar-web-home-button svg")).toBeTruthy();
    expect(container!.querySelectorAll('button[aria-label="Home"]')).toHaveLength(1);
    expect(container!.querySelector(".mari-title-home-button")).toBeNull();
  });

  it("keeps the sidebar collapse control available in web mode", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar webMode />);
    });

    const sidebarToggle = container!.querySelector<HTMLButtonElement>('[data-tour="sidebar-toggle"]');

    expect(sidebarToggle).toBeTruthy();
    expect(sidebarToggle?.getAttribute("aria-label")).toBe("Close chats");

    await act(async () => {
      sidebarToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it("treats browser-hosted shells without desktop controls as web mode", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar />);
    });

    expect(container!.querySelector('[aria-label="Window controls"]')).toBeNull();
    expect(container!.querySelector(".mari-titlebar-web-home-button svg")).toBeTruthy();
    expect(container!.querySelectorAll('button[aria-label="Home"]')).toHaveLength(1);
    expect(container!.querySelector(".mari-title-home-button")).toBeNull();
  });

  it("places the titlebar accessory on the left side of the titlebar", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar titlebarAccessory={<div data-testid="music-toolbar">Music DJ</div>} />);
    });

    expect(container!.querySelector(".mari-title-drag-region [data-testid='music-toolbar']")).toBeTruthy();
    expect(container!.querySelector(".mari-window-actions [data-testid='music-toolbar']")).toBeNull();
  });
});
