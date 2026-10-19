import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../catalog/presets/index", () => ({ usePresetSummaries: () => ({ data: [] }) }));

import { PeekPromptModal } from "./PeekPromptModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  messages: [{ role: "system" as const, content: "You are Wren." }],
  parameters: null,
  source: "raw_messages" as const,
};

describe("PeekPromptModal", () => {
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

  it("closes on Escape", () => {
    const onClose = vi.fn();
    act(() => root.render(<PeekPromptModal data={data} onClose={onClose} />));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is a labelled dialog with a named close button", () => {
    act(() => root.render(<PeekPromptModal data={data} onClose={vi.fn()} />));

    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Assembled prompt");
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
  });
});
