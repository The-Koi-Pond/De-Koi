import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ExtensionRemovalDialog } from "./ExtensionRemovalDialog";

describe("ExtensionRemovalDialog", () => {
  it("offers explicit retain and destructive purge choices", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <ExtensionRemovalDialog
          extension={{ id: "x", name: "Pond", description: "", enabled: false } as never}
          pending={false}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
        />,
      ),
    );
    const labels = Array.from(container.querySelectorAll("button"), (button) => button.textContent?.trim());
    expect(labels).toContain("Remove extension");
    expect(labels).toContain("Remove extension and its data");
    act(() => root.unmount());
  });
});
