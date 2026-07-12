import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { HelpHub } from "./HelpHub";

describe("HelpHub feature discovery", () => {
  it("offers a direct Find a feature action", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenDiscover = vi.fn();

    act(() => {
      root.render(
        <HelpHub
          open
          onClose={vi.fn()}
          onOpenHealth={vi.fn()}
          onReplayOnboarding={vi.fn()}
          onOpenDiscover={onOpenDiscover}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Find a feature"),
    );
    expect(button).toBeTruthy();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenDiscover).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });
});
