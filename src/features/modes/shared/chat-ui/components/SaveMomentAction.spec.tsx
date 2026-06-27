import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "../../../../../shared/stores/gallery.store";
import { IllustrateMomentAction } from "./SaveMomentAction";

describe("IllustrateMomentAction", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useGalleryStore.setState({ illustratingChatIds: [] });
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
    useGalleryStore.setState({ illustratingChatIds: [] });
  });

  it("shows the paintbrush as busy while the illustration request is pending", async () => {
    let resolveIllustration: () => void = () => undefined;
    const illustration = new Promise<void>((resolve) => {
      resolveIllustration = resolve;
    });

    act(() => {
      root = createRoot(container!);
      root.render(
        <IllustrateMomentAction
          source={{
            chatId: "chat-a",
            messageId: "message-a",
            role: "assistant",
            content: "A pond at dusk",
            createdAt: "2026-06-26T12:00:00.000Z",
          }}
          onIllustrateMoment={() => illustration}
        />,
      );
    });

    const button = container!.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Illustrating this message");

    await act(async () => {
      resolveIllustration();
      await illustration;
    });

    expect(button.getAttribute("aria-busy")).toBe("false");
  });
});
