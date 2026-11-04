import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogActionBar } from "./CatalogPanelControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CatalogActionBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(selectionMode: boolean, { withMaker = true }: { withMaker?: boolean } = {}) {
    act(() =>
      root.render(
        <CatalogActionBar
          tone="koi"
          selectionMode={selectionMode}
          onCreate={() => undefined}
          onImport={() => undefined}
          onOpenMaker={withMaker ? () => undefined : undefined}
          onToggleSelectionMode={() => undefined}
        />,
      ),
    );
  }

  it("labels every action with words", () => {
    render(false);
    const labels = [...container.querySelectorAll("button span")];
    expect(labels.map((label) => label.textContent)).toEqual(["New", "Import", "Maker", "Select"]);
  });

  it("shows three cells when the library has no Maker", () => {
    render(false, { withMaker: false });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["New", "Import", "Select"]);
  });

  it("reports whether selection mode is on", () => {
    render(true);
    const select = [...container.querySelectorAll("button")].find((button) => button.textContent === "Select");
    expect(select?.getAttribute("aria-pressed")).toBe("true");
  });
});
