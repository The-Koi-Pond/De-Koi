import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ChatGallery", () => ({ ChatGallery: () => <div>gallery grid</div> }));

import { ChatGalleryDrawer } from "./ChatGalleryDrawer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chat = { id: "chat-1", name: "Chat", mode: "roleplay", metadata: {} } as never;

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("ChatGalleryDrawer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("closes on Escape while open", () => {
    const onClose = vi.fn();
    act(() => root.render(<ChatGalleryDrawer chat={chat} open onClose={onClose} />));

    pressEscape();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores Escape while closed", () => {
    const onClose = vi.fn();
    act(() => root.render(<ChatGalleryDrawer chat={chat} open={false} onClose={onClose} />));

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });
});
