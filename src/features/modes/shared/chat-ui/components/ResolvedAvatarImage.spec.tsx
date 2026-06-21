import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ResolvedAvatarImage } from "./ResolvedAvatarImage";

describe("ResolvedAvatarImage", () => {
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

  it("applies avatar crop consistently while preserving caller style", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <ResolvedAvatarImage
          src="avatar.png"
          alt="Avatar"
          crop={{ zoom: 1.5, offsetX: -12, offsetY: 8 }}
          className="h-full w-full object-cover"
          style={{ opacity: 0.75 }}
        />,
      );
    });

    const image = container!.querySelector<HTMLImageElement>("img");
    expect(image).not.toBeNull();
    expect(image?.style.transform).toBe("scale(1.5) translate(-12%, 8%)");
    expect(image?.style.opacity).toBe("0.75");
  });
});
