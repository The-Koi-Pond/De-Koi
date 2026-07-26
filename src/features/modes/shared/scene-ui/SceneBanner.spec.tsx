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
    const onConclude = vi.fn();
    const onAbandon = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        }),
    );
    const onFork = vi.fn();
    vi.mocked(showConfirmDialog).mockResolvedValue(true);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <EndSceneBar
          sceneChatId="scene-1"
          originChatId="origin-1"
          onConclude={onConclude}
          onAbandon={onAbandon}
          onFork={onFork}
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

    const endButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "End Scene",
    );
    const convertButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Convert",
    );
    expect(endButton).toHaveProperty("disabled", true);
    expect(convertButton).toHaveProperty("disabled", true);

    await act(async () => {
      endButton!.click();
      convertButton!.click();
    });

    expect(onConclude).not.toHaveBeenCalled();
    expect(onFork).not.toHaveBeenCalled();

    await act(async () => {
      finishDiscard?.();
    });
  });

  it("keeps the scene when discard confirmation is cancelled", async () => {
    const onAbandon = vi.fn();
    vi.mocked(showConfirmDialog).mockResolvedValue(false);

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

    await act(async () => {
      discardButton!.click();
    });

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(onAbandon).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Discard");
    expect(container!.textContent).not.toContain("Discarding...");
  });
});
