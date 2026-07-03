import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveWorldInfoButton } from "./ActiveWorldInfoButton";

const mocks = vi.hoisted(() => ({
  useActiveLorebookEntries: vi.fn(() => ({ data: undefined, isLoading: false })),
  useUIStore: vi.fn((selector: (state: { centerCompact: boolean }) => unknown) => selector({ centerCompact: false })),
}));

vi.mock("../../../catalog/lorebooks/index", () => ({
  useActiveLorebookEntries: mocks.useActiveLorebookEntries,
}));

vi.mock("../../../../shared/stores/ui.store", () => ({
  useUIStore: mocks.useUIStore,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ActiveWorldInfoButton", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  async function renderButton() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ActiveWorldInfoButton chatId="chat-1" />);
    });
  }

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("does not enable the active lorebook scan while the popover is closed", async () => {
    await renderButton();

    expect(mocks.useActiveLorebookEntries).toHaveBeenCalledWith("chat-1", false, {
      includeTestScanTrigger: true,
    });
  });

  it("enables the active lorebook scan after the popover opens", async () => {
    await renderButton();

    const button = container?.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.useActiveLorebookEntries).toHaveBeenCalledWith("chat-1", true, {
      includeTestScanTrigger: true,
    });
  });
});