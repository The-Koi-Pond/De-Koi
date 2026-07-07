import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorSaveStatus, UnsavedChangesBar } from "./ExplicitSaveChrome";

describe("explicit save chrome", () => {
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

  it("renders one consistent status location for saved, unsaved, saving, and error states", () => {
    act(() => {
      root = createRoot(container);
      root.render(<EditorSaveStatus dirty={false} saving={false} saved={true} error={null} />);
    });

    expect(container.textContent).toContain("Saved");

    act(() => {
      root?.render(<EditorSaveStatus dirty saving={false} saved={false} error={null} />);
    });
    expect(container.textContent).toContain("Unsaved");

    act(() => {
      root?.render(<EditorSaveStatus dirty saving saved={false} error={null} />);
    });
    expect(container.textContent).toContain("Saving");

    act(() => {
      root?.render(<EditorSaveStatus dirty={false} saving={false} saved={false} error="Save failed" />);
    });
    expect(container.textContent).toContain("Save failed");
  });

  it("uses the shared dirty-close labels for route editors", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <UnsavedChangesBar saving={false} onDiscard={vi.fn()} onKeepEditing={vi.fn()} onSaveAndClose={vi.fn()} />,
      );
    });

    expect(container.textContent).toContain("Keep editing");
    expect(container.textContent).toContain("Discard");
    expect(container.textContent).toContain("Save & close");
  });
});
