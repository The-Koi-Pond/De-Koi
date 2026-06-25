import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SceneBanner } from "./SceneBanner";

describe("SceneBanner", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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
});
