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

  it("drops Import and adds a named extra cell for a list without imports (the chat list)", () => {
    let folderClicks = 0;
    act(() =>
      root.render(
        <CatalogActionBar
          tone="koi"
          selectionMode={false}
          onCreate={() => undefined}
          createLabel="New chat"
          extraAction={{ label: "Folder", title: "New folder", icon: null, onClick: () => (folderClicks += 1) }}
          onToggleSelectionMode={() => undefined}
          selectDisabled
        />,
      ),
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["New chat", "Folder", "Select"]);
    expect(container.firstElementChild?.className).toContain("grid-cols-3");
    act(() => buttons[1]!.click());
    expect(folderClicks).toBe(1);
    expect(buttons[2]!.disabled).toBe(true);
  });

  it("reports whether selection mode is on", () => {
    render(true);
    const select = [...container.querySelectorAll("button")].find((button) => button.textContent === "Select");
    expect(select?.getAttribute("aria-pressed")).toBe("true");
  });
});
