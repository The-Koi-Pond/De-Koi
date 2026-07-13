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
});
