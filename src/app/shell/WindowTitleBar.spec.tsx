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

  it("hides desktop window controls while showing a home action before the fish logo", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<WindowTitleBar webMode />);
    });

    expect(container!.querySelector('[aria-label="Window controls"]')).toBeNull();
    expect(container!.querySelector(".mari-titlebar-web-home-button svg")).toBeTruthy();
    expect(container!.querySelector(".mari-title-home-button img")?.getAttribute("src")).toBe("/favicon.png");
  });
});
