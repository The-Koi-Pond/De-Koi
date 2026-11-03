import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DekiWorkingWindow } from "./DekiWorkingWindow";

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe("DekiWorkingWindow", () => {
  let previousActEnvironment: boolean | undefined;
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    previousActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    container?.remove();
    container = null;
  });

  it("shows Deki instead of retired mascot art", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<DekiWorkingWindow visible />);
    });

    const image = container.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("src")).toBe("/deki.svg");
    expect(container.textContent).not.toMatch(/Dottore|Professor Mari/i);
  });

  it("drops the picture but keeps the message when Deki fails to load", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(<DekiWorkingWindow visible />);
    });

    await act(async () => {
      container?.querySelector("img")?.dispatchEvent(new Event("error", { bubbles: true }));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Deki-senpai is working...");
  });
});
