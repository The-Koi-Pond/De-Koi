import { describe, expect, it, vi } from "vitest";

import { createOverlayStack } from "./overlay-stack";

describe("overlay stack", () => {
  it("handles Escape with the most recently registered active overlay first", () => {
    const stack = createOverlayStack();
    const lower = vi.fn(() => true);
    const top = vi.fn(() => true);

    stack.register({ id: "drawer", onEscape: lower });
    stack.register({ id: "modal", onEscape: top });

    expect(stack.handleEscape()).toBe(true);
    expect(top).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("falls through inactive overlays and stops once a handler consumes Escape", () => {
    const stack = createOverlayStack();
    const lower = vi.fn(() => true);
    const inactiveTop = vi.fn(() => true);

    stack.register({ id: "drawer", onEscape: lower });
    stack.register({ id: "popover", active: false, onEscape: inactiveTop });

    expect(stack.handleEscape()).toBe(true);
    expect(lower).toHaveBeenCalledTimes(1);
    expect(inactiveTop).not.toHaveBeenCalled();
  });

  it("keeps dirty-close flows in the top overlay instead of closing layers underneath", () => {
    const stack = createOverlayStack();
    const dirtyGuard = vi.fn(() => true);
    const drawerClose = vi.fn(() => true);

    stack.register({ id: "drawer", onEscape: drawerClose });
    stack.register({ id: "dirty-editor", onEscape: dirtyGuard });

    expect(stack.handleEscape()).toBe(true);
    expect(dirtyGuard).toHaveBeenCalledTimes(1);
    expect(drawerClose).not.toHaveBeenCalled();
  });
});
