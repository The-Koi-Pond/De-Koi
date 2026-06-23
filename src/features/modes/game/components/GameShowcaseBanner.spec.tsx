import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameShowcaseBanner } from "./GameShowcaseBanner";

const openRightPanel = vi.fn();

vi.mock("../../../../shared/stores/ui.store", () => ({
  useUIStore: (selector: (state: { openRightPanel: typeof openRightPanel }) => unknown) =>
    selector({ openRightPanel }),
}));

describe("GameShowcaseBanner", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    openRightPanel.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("routes showcase users to Connections when they want generation", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<GameShowcaseBanner />);
    });

    const button = Array.from(container!.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Open Connections"),
    );
    expect(container!.textContent).toContain("sample world");
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openRightPanel).toHaveBeenCalledWith("connections");
  });
});
