import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

describe("Modal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function renderModal(open: boolean, onClose = vi.fn()) {
    act(() => {
      root.render(
        <Modal open={open} onClose={onClose} title="Test modal">
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Modal>,
      );
    });
    return onClose;
  }

  it("focuses its named close button and uses the visible heading as its accessible title", () => {
    renderModal(true);

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const heading = container.querySelector<HTMLHeadingElement>("h2");
    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Close Test modal"]');

    expect(dialog?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(dialog?.hasAttribute("aria-label")).toBe(false);
    expect(document.activeElement).toBe(closeButton);
  });

  it("uses semantic modal chrome and the shared close-target contract", () => {
    renderModal(true);

    const panel = container.querySelector<HTMLElement>(".mari-modal-panel")!;
    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Close Test modal"]')!;

    expect(panel.className).not.toContain("os-window");
    expect(container.querySelector(".pastel-gradient")).toBeNull();
    expect(panel.className).toContain("border-[var(--border)]");
    expect(panel.className).toContain("bg-[var(--card)]");
    expect(closeButton.className).toContain("de-koi-icon-target");
  });

  it("wraps forward and reverse Tab navigation within the modal", () => {
    renderModal(true);

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const [closeButton, firstAction, lastAction] = buttons;

    lastAction.focus();
    const forwardTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dialog.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    const reverseTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(reverseTab);
    expect(reverseTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastAction);

    firstAction.focus();
    const ordinaryTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dialog.dispatchEvent(ordinaryTab);
    expect(ordinaryTab.defaultPrevented).toBe(false);
  });

  it("restores focus to the opener after closing", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open modal";
    document.body.insertBefore(opener, container);
    opener.focus();

    renderModal(true);
    renderModal(false);

    expect(document.activeElement).toBe(opener);
  });

  it("preserves Escape and backdrop closing", () => {
    const onClose = renderModal(true);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => dialog.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
