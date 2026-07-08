import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFindOverlay } from "./AppFindOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppFindOverlay", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  async function renderOverlay() {
    await act(async () => {
      root = createRoot(container!);
      root.render(<AppFindOverlay />);
    });
  }

  async function openFind() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
    });
  }

  it("debounces document scans while typing", async () => {
    await renderOverlay();
    await openFind();
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Find..."]');

    expect(input).not.toBeNull();

    const treeWalkerSpy = vi.spyOn(document, "createTreeWalker");

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "moon");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(treeWalkerSpy).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(treeWalkerSpy).toHaveBeenCalledTimes(1);
  });
});
