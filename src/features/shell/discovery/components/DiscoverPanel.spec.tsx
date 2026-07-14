import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "../../../../shared/stores/chat.store";
import { DiscoverPanel } from "./DiscoverPanel";

describe("DiscoverPanel contextual destinations", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useChatStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<DiscoverPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("announces a blocked destination and presents its explicit alternative", () => {
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="Search features"]');
    expect(input).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "game journal");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Open Game Journal",
    );
    expect(openButton).toBeDefined();
    act(() => openButton?.click());

    const blockedStatus = container.querySelector('[data-discovery-status="blocked"]');
    expect(blockedStatus).not.toBeNull();
    expect(blockedStatus?.getAttribute("role")).toBe("alert");
    expect(blockedStatus?.textContent).toContain("Unavailable in the current context");
    expect(blockedStatus?.textContent).toContain("Game Journal needs an active chat.");
    expect(blockedStatus?.textContent).toContain("Choose a chat");
  });
});
