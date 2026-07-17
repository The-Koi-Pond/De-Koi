import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageActivity } from "./use-page-activity";

describe("usePageActivity", () => {
  let container: HTMLDivElement;
  let root: Root;

  function Harness() {
    const active = usePageActivity();
    return <span data-active={String(active)} />;
  }

  function setVisibility(value: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("treats a visible mobile page as active even without document focus", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    act(() => root.render(<Harness />));

    expect(container.querySelector("span")?.dataset.active).toBe("true");
  });

  it("stops work while hidden and resumes once visible without a focus event", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => root.render(<Harness />));

    act(() => setVisibility("hidden"));
    expect(container.querySelector("span")?.dataset.active).toBe("false");

    act(() => setVisibility("visible"));
    expect(container.querySelector("span")?.dataset.active).toBe("true");
  });
});
