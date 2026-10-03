import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameTutorial } from "./GameTutorial";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(label: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("GameTutorial", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows unmistakable exit controls on every step", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<GameTutorial open onClose={onClose} />);
    });

    expect(document.body.querySelector('button[aria-label="Close tutorial"]')).toBeTruthy();
    expect(document.body.textContent).toContain("You don't need to click the highlighted controls.");
    expect(findButton("Exit tutorial")).toBeTruthy();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Close tutorial"]')?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<GameTutorial open onClose={onClose} />);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the leaving card at its own target while the next one is measured", async () => {
    vi.useFakeTimers();
    const rects: Record<string, DOMRect> = {
      "game-map": { top: 100, left: 100, width: 200, height: 120, right: 300, bottom: 220, x: 100, y: 100 } as DOMRect,
      "game-party": { top: 500, left: 700, width: 160, height: 80, right: 860, bottom: 580, x: 700, y: 500 } as DOMRect,
    };
    const targets = Object.keys(rects).map((target) => {
      const el = document.createElement("div");
      el.dataset.tour = target;
      el.getBoundingClientRect = () => rects[target];
      document.body.appendChild(el);
      return el;
    });
    try {
      await act(async () => {
        root.render(<GameTutorial open onClose={vi.fn()} />);
      });
      const card = () => document.body.querySelector<HTMLElement>(".motion-enter, .motion-exit")!;
      const firstPlacement = { top: card().style.top, left: card().style.left };

      await act(async () => {
        findButton("Next")?.click();
      });

      expect(card().className).toContain("motion-exit");
      expect({ top: card().style.top, left: card().style.left }).toEqual(firstPlacement);

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(card().className).toContain("motion-enter");
      expect({ top: card().style.top, left: card().style.left }).not.toEqual(firstPlacement);
    } finally {
      for (const el of targets) el.remove();
      vi.useRealTimers();
    }
  });
});
