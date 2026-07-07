import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryErrorState } from "./QueryErrorState";

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe("QueryErrorState", () => {
  let previousActEnvironment: boolean | undefined;
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    previousActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container.remove();
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("renders human recovery copy and a retry action", () => {
    const onRetry = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(
        <QueryErrorState
          title="Assets unavailable"
          message="Couldn't load game assets. Try again."
          onRetry={onRetry}
        />,
      );
    });

    expect(container.textContent).toContain("Assets unavailable");
    expect(container.textContent).toContain("Couldn't load game assets. Try again.");
    expect(container.textContent).toContain("Retry");

    act(() => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
