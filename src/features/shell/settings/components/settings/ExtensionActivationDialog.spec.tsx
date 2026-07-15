import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ExtensionActivationDialog } from "./ExtensionActivationDialog";

describe("ExtensionActivationDialog", () => {
  it("states the page-level trust boundary and unavailable helpers", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(
      <ExtensionActivationDialog
        extension={{ id: "x", name: "Pond", source: "package", js: "x", permissions: ["prompt:read"] } as never}
        compatibility="compatible"
        consent={null}
        onCancel={vi.fn()}
        onActivate={vi.fn()}
        onRevoke={vi.fn()}
      />,
    ));
    expect(container.textContent).toContain("trusted page-level code");
    expect(container.textContent).toContain("not direct browser-page access");
    expect(container.textContent).toContain("unavailable");
    act(() => root.unmount());
  });
});
