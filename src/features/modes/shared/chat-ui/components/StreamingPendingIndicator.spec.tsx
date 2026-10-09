import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useChatStore } from "../../../../../shared/stores/chat.store";
import { StreamingPendingIndicator } from "./StreamingPendingIndicator";

let root: Root | null = null;

function render(chatId: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<StreamingPendingIndicator chatId={chatId} />));
  return container;
}

describe("StreamingPendingIndicator", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    for (const chatId of ["chat-1", "chat-2"]) useChatStore.getState().setGenerationPhase(chatId, null);
  });

  it("shows what this chat's generation is doing before the reply streams, and follows it", () => {
    useChatStore.getState().setGenerationPhase("chat-1", "Finishing the last reply's trackers...");
    const container = render("chat-1");

    expect(container.textContent).toBe("Finishing the last reply's trackers...");
    expect(container.querySelector("[role=status]")?.getAttribute("aria-label")).toBe(
      "Finishing the last reply's trackers...",
    );

    act(() => useChatStore.getState().setGenerationPhase("chat-1", "Calling model..."));
    expect(container.textContent).toBe("Calling model...");
  });

  it("shows only the pending animation when its chat has no phase, whatever other chats are doing", () => {
    useChatStore.getState().setGenerationPhase("chat-2", "Calling model...");
    const container = render("chat-1");

    expect(container.textContent).toBe("");
    expect(container.querySelector("[role=status]")?.getAttribute("aria-label")).toBe("Assistant response is starting");
  });
});
