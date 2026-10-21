import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CharactersPanelActionBar } from "./CharactersPanelActionBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CharactersPanelActionBar", () => {
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

  function render(selectionMode: boolean) {
    act(() =>
      root.render(
        <CharactersPanelActionBar
          selectionMode={selectionMode}
          onCreate={() => undefined}
          onImport={() => undefined}
          onOpenMaker={() => undefined}
          onToggleSelectionMode={() => undefined}
        />,
      ),
    );
  }

  it("labels every action with visible words at every width", () => {
    render(false);
    const labels = [...container.querySelectorAll("button span")];
    expect(labels.map((label) => label.textContent)).toEqual(["New", "Import", "Maker", "Select"]);
    for (const label of labels) expect(label.className).not.toMatch(/hidden/);
  });

  it("reports whether selection mode is on", () => {
    render(true);
    const select = [...container.querySelectorAll("button")].find((button) => button.textContent === "Select");
    expect(select?.getAttribute("aria-pressed")).toBe("true");
  });
});
