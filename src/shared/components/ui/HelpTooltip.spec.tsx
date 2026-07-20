import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HelpTooltip } from "./HelpTooltip";

describe("HelpTooltip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <HelpTooltip text="Controls how quickly replies appear. Native notifications stay private." />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
  const tooltip = () => document.body.querySelector<HTMLElement>('[role="tooltip"]');

  it("uses contextual naming and exposes the visible tooltip relationship", () => {
    expect(trigger().getAttribute("aria-label")).toBe("Help: Controls how quickly replies appear.");
    expect(trigger().getAttribute("aria-label")).not.toContain("Native notifications");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    act(() => trigger().focus());

    expect(tooltip()?.textContent).toBe(
      "Controls how quickly replies appear. Native notifications stay private.",
    );
    expect(tooltip()?.id).toBeTruthy();
    expect(trigger().getAttribute("aria-describedby")).toBe(tooltip()?.id);
    expect(trigger().getAttribute("aria-controls")).toBe(tooltip()?.id);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("supports keyboard focus, Escape, activation, and outside dismissal", () => {
    act(() => trigger().focus());
    expect(tooltip()).toBeTruthy();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tooltip()).toBeNull();

    act(() => trigger().click());
    expect(tooltip()).toBeTruthy();

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(tooltip()).toBeNull();
  });
});
