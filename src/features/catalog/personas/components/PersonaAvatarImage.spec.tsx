import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PersonaAvatarImage } from "./PersonaAvatarImage";

describe("PersonaAvatarImage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("provides the clipping frame required by avatar crops", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <PersonaAvatarImage
          persona={{
            name: "Mira",
            avatarPath: "persona.png",
            avatarCrop: { zoom: 1.25, offsetX: 10, offsetY: -6 },
          }}
          className="h-7 w-7 rounded-full"
        />,
      );
    });

    const frame = container!.querySelector("span");
    const image = container!.querySelector<HTMLImageElement>("img");
    expect(frame?.className).toContain("relative");
    expect(frame?.className).toContain("overflow-hidden");
    expect(image?.style.transform).toBe("scale(1.25) translate(10%, -6%)");
  });
});
