import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { EndSceneBar, SceneBanner } from "./SceneBanner";

vi.mock("../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: vi.fn(),
}));

describe("SceneBanner", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.mocked(showConfirmDialog).mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("offers a reopen action for concluded scene chats", () => {
    const onReopen = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(<SceneBanner variant="scene" originChatId="origin-1" sceneChatId="scene-1" onReopen={onReopen} />);
    });

    const reopenButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Reopen scene"),
    );

    expect(reopenButton).toBeTruthy();

    act(() => {
      reopenButton!.click();
    });

    expect(onReopen).toHaveBeenCalledWith("scene-1");
  });

  it("confirms scene discard in the app dialog and shows progress until deletion finishes", async () => {
    let finishDiscard: (() => void) | undefined;
    const onAbandon = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        }),
    );
    vi.mocked(showConfirmDialog).mockResolvedValue(true);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <EndSceneBar
          sceneChatId="scene-1"
          originChatId="origin-1"
          onConclude={vi.fn()}
          onAbandon={onAbandon}
        />,
      );
    });

    const discardButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Discard",
    );
    expect(discardButton).toBeTruthy();

    await act(async () => {
      discardButton!.click();
    });

    expect(showConfirmDialog).toHaveBeenCalledWith({
      title: "Discard this scene?",
      message: "This will permanently delete the scene without saving a summary or memory.",
      confirmLabel: "Discard",
      cancelLabel: "Keep Scene",
      tone: "destructive",
    });
    expect(onAbandon).toHaveBeenCalledWith("scene-1");

    const pendingButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Discarding...",
    );
    expect(pendingButton).toBeTruthy();
    expect(pendingButton).toHaveProperty("disabled", true);
    expect(container!.textContent).not.toContain("Discard scene?");

    await act(async () => {
      finishDiscard?.();
    });
  });
});
