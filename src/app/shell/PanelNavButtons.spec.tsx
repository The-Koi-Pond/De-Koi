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

  it("shows labeled Library and Tools menu controls", () => {
    expect(container.querySelector('button[aria-label="Library"]')?.textContent).toContain("Library");
    expect(container.querySelector('button[aria-label="Tools"]')?.textContent).toContain("Tools");
    expect(container.querySelector('button[aria-label="More navigation"]')?.textContent).toContain("More");
  });

  it("opens with Space, moves with arrows, and Escape restores trigger focus", () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Library"]')!;
    trigger.focus();
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual([
      "Browser",
      "Characters",
      "Personas",
      "Lorebooks",
      "Presets",
      "Gallery",
    ]);
    expect(document.activeElement).toBe(items[0]);
    act(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    act(() => items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens with Enter and supports reverse and horizontal arrow navigation", () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Tools"]')!;
    trigger.focus();
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'));
    expect(document.activeElement).toBe(items[0]);
    act(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(items.at(-1));
    act(() => items.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement).toBe(items.at(-2));
    act(() => items.at(-2)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(items.at(-1));
  });

  it("marks the open panel as the active menu destination", () => {
    act(() => useUIStore.setState({ rightPanelOpen: true, rightPanel: "connections" }));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Tools"]')!;
    act(() => trigger.click());
    expect(container.querySelector('[role="menuitem"][aria-current="page"]')?.textContent).toBe("Connections");
  });
});
