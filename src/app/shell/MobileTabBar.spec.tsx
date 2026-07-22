import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../shared/stores/chat.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { MobileTabBar } from "./MobileTabBar";

function renderMobileTabBar({
  dekiOpen = false,
  leftSidebarPanel = "chats" as const,
  onGoHome = vi.fn(),
  toolsSheetOpen = false,
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onLeftSidebarPanelChange = vi.fn();

  act(() => {
    root.render(
      <MobileTabBar
        dekiOpen={dekiOpen}
        leftSidebarPanel={leftSidebarPanel}
        toolsSheetOpen={toolsSheetOpen}
        toolsSheetRef={createRef<HTMLDivElement>()}
        trackerPanelVisible={false}
        onToolsSheetOpenChange={vi.fn()}
        onLeftSidebarPanelChange={onLeftSidebarPanelChange}
        onToggleDeki={vi.fn()}
        onGoHome={onGoHome}
        onOpenDiscover={vi.fn()}
      />,
    );
  });

  return { container, root, onLeftSidebarPanelChange, onGoHome };
}

describe("MobileTabBar left sidebar controls", () => {
  const roots: Root[] = [];
  const containers: HTMLDivElement[] = [];

  beforeEach(() => {
    window.localStorage.clear();
    useChatStore.getState().reset();
    useUIStore.setState({ rightPanelOpen: false, mobileChatToolsOpen: false });
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    for (const container of containers.splice(0)) container.remove();
    useChatStore.getState().reset();
    useUIStore.getState().closeRightPanel();
    vi.restoreAllMocks();
  });

  it("keeps the Deki tab active only for the left Deki sidebar", () => {
    const rendered = renderMobileTabBar({ dekiOpen: true, leftSidebarPanel: "chats" });
    roots.push(rendered.root);
    containers.push(rendered.container);

    const dekiButton = rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Deki-senpai"]');

    expect(dekiButton).toBeTruthy();
    expect(dekiButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      dekiButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(rendered.onLeftSidebarPanelChange).toHaveBeenCalledWith("deki");
    expect(rendered.onGoHome).not.toHaveBeenCalled();
  });

  it("groups Library and Tools destinations in a touch-sized tools sheet", () => {
    const rendered = renderMobileTabBar({ toolsSheetOpen: true });
    roots.push(rendered.root);
    containers.push(rendered.container);

    expect(rendered.container.textContent).toContain("Library");
    expect(rendered.container.textContent).toContain("Tools");
    const menuItems = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'));
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Browser",
      "Characters",
      "Personas",
      "Lorebooks",
      "Presets",
      "Gallery",
      "Connections",
      "Agents",
      "Settings",
      "Help",
      "Discover",
    ]);
    expect(menuItems.every((item) => item.className.includes("min-h-11"))).toBe(true);
  });

  it("uses the 14px semantic body role for persistent mobile navigation", () => {
    const rendered = renderMobileTabBar();
    roots.push(rendered.root);
    containers.push(rendered.container);

    const tabButtons = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Main navigation"] button'),
    );
    expect(tabButtons).toHaveLength(3);
    expect(tabButtons.every((button) => button.className.includes("de-koi-body"))).toBe(true);
    expect(tabButtons.every((button) => !/text-\[0/.test(button.className))).toBe(true);
  });
});
