import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogListState, CatalogListRow } from "./CatalogListPrimitives";

describe("catalog list primitives", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders consistent loading, empty, and error states for catalog panels", () => {
    act(() => {
      root = createRoot(container);
      root.render(<CatalogListState state="loading" label="agents" />);
    });
    expect(container.textContent).toContain("Loading agents");

    act(() => {
      root?.render(<CatalogListState state="empty" label="custom agents" />);
    });
    expect(container.textContent).toContain("No custom agents yet");

    act(() => {
      root?.render(<CatalogListState state="error" label="regex scripts" message="Storage failed" />);
    });
    expect(container.textContent).toContain("Storage failed");
  });

  it("exposes shared row state and drag affordance attributes", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <CatalogListRow draggable selected dragging contextMenu="available">
          Example
        </CatalogListRow>,
      );
    });

    const row = container.querySelector("[data-catalog-list-row]");
    expect(row).toBeTruthy();
    expect(row?.getAttribute("draggable")).toBe("true");
    expect(row?.getAttribute("data-selected")).toBe("true");
    expect(row?.getAttribute("data-dragging")).toBe("true");
    expect(row?.getAttribute("data-context-menu")).toBe("available");
  });
});
