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
  rebuildMemoryIndex: {
    mutateAsync: vi.fn(async () => ({ rebuilt: 1 })),
    isPending: false,
  },
}));

vi.mock("../hooks/use-character-memories", () => ({
  useCharacterMemories: () => ({ data: [], isLoading: false }),
  useCreateCharacterMemory: () => hookMocks.createMemory,
  useRebuildCharacterMemoryIndex: () => hookMocks.rebuildMemoryIndex,
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
    hookMocks.createMemory.mutateAsync.mockImplementation(async () => ({
      memory: { id: "memory-new" },
      indexRefreshFailed: false,
    }));
    hookMocks.rebuildMemoryIndex.mutateAsync.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  function renderTab(characterId = "char-1", characterName = "Mira") {
    act(() => {
      root ??= createRoot(container!);
      root.render(
        <CharacterMemoriesTab
          characterId={characterId}
          characterName={characterName}
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
    expect(container!.textContent).toContain("Enter a memory before saving.");
    await act(async () => save?.click());
    expect(hookMocks.createMemory.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps a durable recovery action visible until recall indexing succeeds", async () => {
    hookMocks.createMemory.mutateAsync.mockResolvedValueOnce({
      memory: { id: "memory-new" },
      indexRefreshFailed: true,
    });
    renderTab();
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Mira keeps the brass key.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );
    await act(async () => save?.click());

    expect(container!.textContent).toContain("Memory was saved, but it is not ready for recall.");
    const retry = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry recall indexing",
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    expect(hookMocks.rebuildMemoryIndex.mutateAsync).toHaveBeenCalledOnce();
    expect(container!.textContent).not.toContain("Memory was saved, but it is not ready for recall.");
  });

  it("does not carry an unsaved draft into another character", () => {
    renderTab();
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Only Mira should see this.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    renderTab("char-2", "Nia");

    const nextNewMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    expect(nextNewMemory?.getAttribute("aria-expanded")).toBe("false");
    act(() => nextNewMemory?.click());
    expect(
      container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]')?.value,
    ).toBe("");
  });

  it("does not apply a completed save to a character opened while the request was pending", async () => {
    let finishSave!: (value: { memory: { id: string }; indexRefreshFailed: boolean }) => void;
    hookMocks.createMemory.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    renderTab();
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Only Mira should save this.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );
    act(() => save?.click());

    renderTab("char-2", "Nia");
    const nextNewMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => nextNewMemory?.click());
    const nextTextarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        nextTextarea,
        "Nia's separate draft.",
      );
      nextTextarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => finishSave({ memory: { id: "memory-new" }, indexRefreshFailed: true }));

    expect(nextNewMemory?.getAttribute("aria-expanded")).toBe("true");
    expect(container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]')?.value)
      .toBe("Nia's separate draft.");
    expect(container!.textContent).not.toContain("not ready for recall");
  });
});
