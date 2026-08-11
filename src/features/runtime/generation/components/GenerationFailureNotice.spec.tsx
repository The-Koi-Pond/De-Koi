import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../../shared/stores/chat.store";
import { GenerationFailureNotice } from "./GenerationFailureNotice";

describe("GenerationFailureNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useChatStore.getState().reset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useChatStore.getState().reset();
  });

  it("keeps a failed generation visible and offers retry and dismiss actions", () => {
    const onRetry = vi.fn();
    useChatStore.getState().setGenerationFailure("chat-1", {
      message: "The model connection timed out.",
      failedAt: 1,
    });

    act(() => root.render(<GenerationFailureNotice chatId="chat-1" onRetry={onRetry} />));

    expect(container.textContent).toContain("The model connection timed out.");
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent === "Retry")?.click());
    expect(onRetry).toHaveBeenCalledOnce();

    act(() => buttons.find((button) => button.getAttribute("aria-label") === "Dismiss generation error")?.click());
    expect(useChatStore.getState().generationFailures.has("chat-1")).toBe(false);
    expect(container.textContent).not.toContain("The model connection timed out.");
  });

  it("does not leak another chat's failure", () => {
    useChatStore.getState().setGenerationFailure("chat-2", { message: "Other chat failed.", failedAt: 1 });
    act(() => root.render(<GenerationFailureNotice chatId="chat-1" onRetry={() => undefined} />));
    expect(container.textContent).toBe("");
  });
});
