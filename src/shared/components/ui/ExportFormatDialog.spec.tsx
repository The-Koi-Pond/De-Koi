import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportFormatDialog } from "./ExportFormatDialog";

describe("ExportFormatDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("labels the native export format with the De-Koi product name", () => {
    act(() => {
      root.render(
        <ExportFormatDialog
          open
          title="Export Character"
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("De-Koi Native");
    expect(container.textContent).not.toContain("Marinara Native");
  });
});
