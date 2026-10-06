import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./right-panel-loaders", () => {
  const panel = async () => ({
    default: () => (
      <label>
        Panel field
        <input aria-label="Panel field" />
      </label>
    ),
  });
  return {
    RIGHT_PANEL_LOADERS: new Proxy({}, { get: () => panel }),
  };
});

import { useUIStore } from "../../shared/stores/ui.store";
import { RightPanel } from "./RightPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("RightPanel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useUIStore.setState({ rightPanel: "gallery", rightPanelOpen: true });
    await act(async () => {
      root.render(<RightPanel />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("closes on Escape", () => {
    pressEscape();

    expect(useUIStore.getState().rightPanelOpen).toBe(false);
  });

  it("leaves a focused field inside the panel on the first Escape and closes on the second", () => {
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Panel field"]')!;
    field.focus();

    pressEscape();
    expect(document.activeElement).not.toBe(field);
    expect(useUIStore.getState().rightPanelOpen).toBe(true);

    pressEscape();
    expect(useUIStore.getState().rightPanelOpen).toBe(false);
  });

  it("ignores Escape while typing in a field outside the panel", () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();

    pressEscape();

    expect(useUIStore.getState().rightPanelOpen).toBe(true);
    outside.remove();
  });
});
