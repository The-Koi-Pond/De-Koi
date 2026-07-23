import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterMemoriesTab } from "./CharacterMemoriesTab";

const hookMocks = vi.hoisted(() => ({
  createMemory: {
    mutateAsync: vi.fn(async () => ({
      memory: { id: "memory-new" },
      indexRefreshFailed: false,
    })),
    isPending: false,
  },
}));

vi.mock("../hooks/use-character-memories", () => ({
  useCharacterMemories: () => ({ data: [], isLoading: false }),
  useCreateCharacterMemory: () => hookMocks.createMemory,
  useUpdateCharacterMemory: () => ({ mutateAsync: vi.fn() }),
  useImportCharacterMemories: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCharacterMemorySourceChats: () => ({ data: [] }),
  useChatMemoryRows: () => ({ data: [], isLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

describe("CharacterMemoriesTab manual entry", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    hookMocks.createMemory.mutateAsync.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  function renderTab() {
    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterMemoriesTab
          characterId="char-1"
          characterName="Mira"
          memoryPersistence="character"
          onMemoryPersistenceChange={vi.fn()}
        />,
      );
    });
  }

  it("adds a trimmed memory from the character panel", async () => {
    renderTab();

    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    expect(newMemory).toBeTruthy();
    expect(newMemory?.getAttribute("aria-expanded")).toBe("false");
    expect(newMemory?.getAttribute("aria-controls")).toBeTruthy();
    act(() => newMemory?.click());
    expect(newMemory?.getAttribute("aria-expanded")).toBe("true");

    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]');
    expect(textarea?.closest("[id]")?.id).toBe(newMemory?.getAttribute("aria-controls"));
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );
    expect(textarea).toBeTruthy();
    expect(save).toBeTruthy();

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "  Mira keeps the brass key.  ",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save?.click());

    expect(hookMocks.createMemory.mutateAsync).toHaveBeenCalledWith("Mira keeps the brass key.");
  });

  it("does not submit an empty character memory", async () => {
    renderTab();
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );

    expect(save?.disabled).toBe(true);
    await act(async () => save?.click());
    expect(hookMocks.createMemory.mutateAsync).not.toHaveBeenCalled();
  });
});
