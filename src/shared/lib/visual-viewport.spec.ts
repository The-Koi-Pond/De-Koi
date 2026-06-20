import { describe, expect, test } from "vitest";
import { applyVisualViewportHeightVar } from "./visual-viewport";

describe("applyVisualViewportHeightVar", () => {
  test("uses visualViewport height when the keyboard shrinks the visible viewport", () => {
    const root = document.createElement("div");

    applyVisualViewportHeightVar(root, {
      innerHeight: 800,
      visualViewport: {
        height: 420,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });

    expect(root.style.getPropertyValue("--mari-visual-viewport-height")).toBe("420px");
  });
});
