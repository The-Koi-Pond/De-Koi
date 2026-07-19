import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../shared/stores/ui.store";
import { PanelNavButtons } from "./PanelNavButtons";

describe("PanelNavButtons", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const openDiscover = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useUIStore.setState({ rightPanelOpen: false });
    act(() => root.render(<PanelNavButtons onOpenDiscover={openDiscover} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows the desktop destinations as individual icon controls", () => {
    expect(container.querySelector('button[aria-label="Library"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Tools"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Characters"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Connections"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Discover"]')).toBeTruthy();
  });

  it("opts every icon-only destination into the shared coarse-pointer target", () => {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));

    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.className.includes("de-koi-icon-target"))).toBe(true);
  });

  it("opens a panel directly from its icon", () => {
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Connections"]')!.click());
    expect(useUIStore.getState().rightPanelOpen).toBe(true);
    expect(useUIStore.getState().rightPanel).toBe("connections");
  });

  it("marks the open panel icon as active", () => {
    act(() => useUIStore.setState({ rightPanelOpen: true, rightPanel: "connections" }));
    expect(container.querySelector('button[aria-label="Connections"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
