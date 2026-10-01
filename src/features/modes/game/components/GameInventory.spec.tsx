import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameInventory } from "./GameInventory";

const items = [
  { name: "Rope", quantity: 1 },
  { name: "Lantern", quantity: 1 },
];

describe("GameInventory slot drag", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let pointerTarget: Element | null = null;
  const onReorderItem = vi.fn();

  const slot = (name: string) => container!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

  const pointer = (type: string, target: Element, init: { x?: number; y?: number; touch?: boolean } = {}) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: init.touch ? "touch" : "mouse" });
    act(() => {
      target.dispatchEvent(event);
    });
  };

  /** A pointer click reports detail 1; keyboard activation (Enter/Space) reports 0. */
  const click = (target: Element, { keyboard = false } = {}) =>
    act(() => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: keyboard ? 0 : 1 }));
    });

  /** Drag Rope onto Lantern; the release is not followed by a click. */
  const dragRopeOntoLantern = (touch = false) => {
    pointerTarget = slot("Lantern");
    pointer("pointerdown", slot("Rope"), { touch });
    if (touch) act(() => vi.advanceTimersByTime(250));
    pointer("pointermove", slot("Rope"), { x: 40, y: 0, touch });
    pointer("pointerup", slot("Rope"), { x: 40, y: 0, touch });
  };

  const tap = (target: Element, touch = false) => {
    pointer("pointerdown", target, { touch });
    pointer("pointerup", target, { touch });
    click(target);
  };

  // jsdom has no layout or pointer capture; these stand in during each test.
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  const originalElementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    vi.useFakeTimers();
    onReorderItem.mockReset();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    document.elementFromPoint = vi.fn(() => pointerTarget);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<GameInventory items={items} open onClose={() => {}} onReorderItem={onReorderItem} canInteract />);
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    pointerTarget = null;
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    document.elementFromPoint = originalElementFromPoint;
    vi.useRealTimers();
  });

  it("keeps the dragged slot's follow-up click from leaking onto other slots", () => {
    dragRopeOntoLantern();
    // A pointer-style click on another slot inside the window (for example
    // from assistive tech, with no pointerdown) still selects that slot.
    click(slot("Lantern"));

    expect(slot("Lantern").getAttribute("aria-pressed")).toBe("true");
  });

  it("swaps slots without selecting the dragged item", () => {
    dragRopeOntoLantern();
    // The browser's follow-up click for the drag is skipped.
    click(slot("Rope"));

    expect(onReorderItem).toHaveBeenCalledWith(0, 1);
    expect(slot("Rope").getAttribute("aria-pressed")).toBe("false");
  });

  it("does not swallow the next click when a mouse drag produced no click", () => {
    dragRopeOntoLantern();
    tap(slot("Lantern"));

    expect(slot("Lantern").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not swallow the next tap when a touch drag produced no click", () => {
    dragRopeOntoLantern(true);
    expect(onReorderItem).toHaveBeenCalledWith(0, 1);
    tap(slot("Lantern"), true);

    expect(slot("Lantern").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not swallow keyboard activation right after a drag", () => {
    dragRopeOntoLantern();
    // Enter or Space on a focused button fires a click with no pointer events,
    // here inside the window where a drag's own click would be skipped.
    click(slot("Lantern"), { keyboard: true });

    expect(slot("Lantern").getAttribute("aria-pressed")).toBe("true");
  });

  it("stops skipping clicks once the drag's window has passed", () => {
    dragRopeOntoLantern();
    act(() => vi.advanceTimersByTime(1000));
    click(slot("Lantern"));

    expect(slot("Lantern").getAttribute("aria-pressed")).toBe("true");
  });
});
