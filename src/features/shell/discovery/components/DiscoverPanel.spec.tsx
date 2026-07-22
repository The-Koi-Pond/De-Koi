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

  it("exposes each mutually exclusive filter as a selected radio option", () => {
    const categoryGroup = container.querySelector('[role="radiogroup"][aria-label="Feature category"]');
    const coverageGroup = container.querySelector('[role="radiogroup"][aria-label="Feature coverage"]');
    expect(categoryGroup).not.toBeNull();
    expect(coverageGroup).not.toBeNull();

    const categoryOptions = Array.from(categoryGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    expect(categoryOptions.length).toBeGreaterThan(1);
    expect(categoryOptions[0]?.getAttribute("aria-checked")).toBe("true");
    expect(categoryOptions[1]?.getAttribute("aria-checked")).toBe("false");

    act(() => categoryOptions[1]?.click());
    expect(categoryOptions[0]?.getAttribute("aria-checked")).toBe("false");
    expect(categoryOptions[1]?.getAttribute("aria-checked")).toBe("true");
  });

  it("owns vertical scrolling for the full Discover surface", () => {
    const panel = container.querySelector(".de-koi-discover");

    expect(panel?.className).toContain("overflow-y-auto");
    expect(panel?.className).toContain("min-h-0");
  });
});
