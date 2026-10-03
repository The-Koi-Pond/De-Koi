import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraggablePanel } from "./DraggablePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const currentDir = dirname(fileURLToPath(import.meta.url));
const STORAGE_KEY = "marinara-game-panel:chat-1:map";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness({ onHeaderClick }: { onHeaderClick: () => void }) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const { locked, toggleLocked, panelRef, dragProps } = useDraggablePanel("chat-1", "map", areaRef);
  const [renders, setRenders] = useState(0);
  return (
    <div ref={areaRef} data-testid="area">
      <div ref={panelRef} data-testid="panel" {...dragProps}>
        <button type="button" data-testid="header" onClick={onHeaderClick}>
          Map
        </button>
        <button type="button" data-testid="lock" onClick={toggleLocked}>
          {locked ? "locked" : "unlocked"}
        </button>
        <span data-testid="day" onPointerDown={(event) => event.stopPropagation()}>
          Day 3
        </span>
        <button type="button" data-testid="rerender" onClick={() => setRenders((count) => count + 1)}>
          {renders}
        </button>
      </div>
    </div>
  );
}

describe("useDraggablePanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onHeaderClick = vi.fn();
  // Where the panel sits on screen, following its current offset.
  let panelOrigin = { left: 100, top: 100 };

  const el = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

  const pointer = (type: string, target: EventTarget, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    act(() => {
      target.dispatchEvent(event);
    });
  };

  const click = (target: Element) =>
    act(() => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });

  /** Press on the header, move by (dx, dy), release, then let the browser's trailing click land. */
  const drag = (dx: number, dy: number, from = "header") => {
    pointer("pointerdown", el(from), 10, 10);
    pointer("pointermove", window, 10 + dx, 10 + dy);
    pointer("pointerup", window, 10 + dx, 10 + dy);
    click(el("header"));
    act(() => vi.runAllTimers());
  };

  const render = (stored?: object) => {
    if (stored) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    act(() => root.render(<Harness onHeaderClick={onHeaderClick} />));
  };

  const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");

  beforeEach(() => {
    vi.useFakeTimers();
    panelOrigin = { left: 100, top: 100 };
    window.localStorage.clear();
    onHeaderClick.mockClear();
    // The panel's on-screen box moves with its transform; the area is 400x300 at the origin.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "area") return rect(0, 0, 400, 300);
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(this.style.transform);
      const offset = match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
      return rect(panelOrigin.left + offset.x, panelOrigin.top + offset.y, 80, 60);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("moves an unlocked panel with the pointer and saves where it was dropped", () => {
    render({ locked: false, x: 0, y: 0 });

    drag(40, 25);

    expect(el("panel").style.transform).toBe("translate3d(40px, 25px, 0)");
    expect(stored()).toMatchObject({ locked: false, x: 40, y: 25, left: 140, top: 125 });
  });

  it("keeps the panel inside the constraint area", () => {
    render({ locked: false, x: 0, y: 0 });

    drag(1000, -1000);

    // The panel starts at (100, 100) and is 80x60 inside a 400x300 area.
    expect(el("panel").style.transform).toBe("translate3d(220px, -100px, 0)");
  });

  it("drags from header controls that stop React pointerdown propagation", () => {
    render({ locked: false, x: 0, y: 0 });

    drag(30, 10, "day");

    expect(el("panel").style.transform).toBe("translate3d(30px, 10px, 0)");
  });

  it("does not move a locked panel", () => {
    render();

    drag(40, 25);

    expect(el("panel").style.transform).toBe("translate3d(0px, 0px, 0)");
    expect(el("panel").style.touchAction).toBe("");
    expect(stored()).toBeNull();
    expect(onHeaderClick).toHaveBeenCalledTimes(1);
  });

  it("swallows the click that ends a drag but keeps taps and small jitters as clicks", () => {
    render({ locked: false, x: 0, y: 0 });
    expect(el("panel").style.touchAction).toBe("none");

    drag(40, 0);
    expect(onHeaderClick).not.toHaveBeenCalled();

    drag(2, 1);
    expect(onHeaderClick).toHaveBeenCalledTimes(1);

    click(el("header"));
    expect(onHeaderClick).toHaveBeenCalledTimes(2);
  });

  it("keeps the dragged offset across re-renders and restores it on the next mount", () => {
    render({ locked: false, x: 0, y: 0 });
    drag(30, 20);

    click(el("rerender"));
    expect(el("panel").style.transform).toBe("translate3d(30px, 20px, 0)");

    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(el("panel").style.transform).toBe("translate3d(30px, 20px, 0)");
  });

  it("ends a cancelled drag where it stopped without swallowing the next click", () => {
    render({ locked: false, x: 0, y: 0 });

    pointer("pointerdown", el("header"), 10, 10);
    pointer("pointermove", window, 30, 20);
    expect(document.body.style.userSelect).toBe("none");
    pointer("pointercancel", window, 30, 20);

    expect(document.body.style.userSelect).toBe("");
    expect(stored()).toMatchObject({ x: 20, y: 10 });
    pointer("pointermove", window, 90, 90);
    expect(el("panel").style.transform).toBe("translate3d(20px, 10px, 0)");
    click(el("header"));
    expect(onHeaderClick).toHaveBeenCalledTimes(1);
  });

  it("releases the page when the panel unmounts mid-drag", () => {
    render({ locked: false, x: 0, y: 0 });
    const removeListener = vi.spyOn(window, "removeEventListener");

    pointer("pointerdown", el("header"), 10, 10);
    pointer("pointermove", window, 40, 40);
    expect(document.body.style.userSelect).toBe("none");
    act(() => root.unmount());

    expect(document.body.style.userSelect).toBe("");
    expect(removeListener.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]),
    );
    const savedBefore = window.localStorage.getItem(STORAGE_KEY);
    pointer("pointerup", window, 40, 40);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(savedBefore);
    root = createRoot(container);
  });

  it("is the only drag engine the game HUD panels use", () => {
    for (const file of ["DraggablePanel.tsx", "GameMap.tsx", "GameWidgetPanel.tsx"]) {
      expect(readFileSync(join(currentDir, file), "utf8")).not.toMatch(/from "framer-motion"/);
    }
  });
});
