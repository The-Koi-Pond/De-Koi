import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceSelectionModal } from "./ChoiceSelectionModal";

const mocks = vi.hoisted(() => ({
  updateMetadata: vi.fn(),
  updatePreset: vi.fn(),
}));

vi.mock("../hooks/use-presets", () => ({
  usePresetFull: () => ({
    isError: false,
    isLoading: false,
    data: {
      preset: {},
      choiceBlocks: [
        {
          id: "block-mode",
          variableName: "mode",
          question: "Choose the primary mode.",
          options: [
            { id: "gm", label: "Game Master", value: "gm" },
            { id: "rp", label: "Roleplayer", value: "rp" },
          ],
        },
        {
          id: "block-pacing",
          variableName: "pacing",
          question: "Choose the pacing style.",
          options: [
            { id: "balanced", label: "Balanced", value: "balanced" },
            { id: "snappy", label: "Snappy", value: "snappy" },
          ],
        },
      ],
    },
  }),
  useUpdatePreset: () => ({ mutate: mocks.updatePreset }),
}));

vi.mock("../../chats/index", () => ({
  useUpdateChatMetadata: () => ({ isPending: false, mutate: mocks.updateMetadata }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChoiceSelectionModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<ChoiceSelectionModal open onClose={() => undefined} presetId="preset-1" chatId="chat-1" />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("keeps Confirm in a pinned footer and confirms the preselected defaults in one click", () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Story options");

    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Confirm Choices"),
    );
    expect(confirm?.closest(".sticky"), "Confirm sits in the pinned footer").not.toBeNull();

    act(() => confirm?.click());

    expect(mocks.updateMetadata).toHaveBeenCalledWith(
      { id: "chat-1", presetChoices: { mode: "gm", pacing: "balanced" } },
      expect.anything(),
    );
  });

  it("shows plain questions and keeps raw variable names out of the visible text", () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Choose the primary mode.");
    expect(dialog?.textContent).not.toContain("{{mode}}");
    const heading = [...document.querySelectorAll("h4")].find((h) => h.textContent === "Choose the pacing style.");
    expect(heading?.getAttribute("title")).toBe("Preset variable {{pacing}}");
  });
});
