import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterMemoriesTab } from "./CharacterMemoriesTab";

const hookMocks = vi.hoisted(() => ({
  memories: [] as Array<Record<string, unknown>>,
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
  updateMemory: {
    mutateAsync: vi.fn(async () => undefined),
  },
  invalidateMemories: vi.fn(async () => undefined),
  cleanupModalProps: null as Record<string, unknown> | null,
  resolveDefaultTextConnectionId: vi.fn(async () => "connection-1"),
}));

vi.mock("../hooks/use-character-memories", () => ({
  useCharacterMemories: () => ({ data: hookMocks.memories, isLoading: false }),
  useCreateCharacterMemory: () => hookMocks.createMemory,
  useRebuildCharacterMemoryIndex: () => hookMocks.rebuildMemoryIndex,
  useUpdateCharacterMemory: () => hookMocks.updateMemory,
  useImportCharacterMemories: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCharacterMemorySourceChats: () => ({ data: [] }),
  useChatMemoryRows: () => ({ data: [], isLoading: false }),
  useInvalidateCharacterMemoryScope: () => hookMocks.invalidateMemories,
}));

vi.mock("../../memory-maintenance", () => ({
  canonicalMemoryCleanupSource: (memory: Record<string, unknown>) => ({
    id: memory.id,
    scope: memory.scope,
    content: memory.content,
  }),
  MemoryCleanupReviewModal: (props: Record<string, unknown>) => {
    hookMocks.cleanupModalProps = props;
    return props.open ? <div data-testid="character-memory-cleanup" /> : null;
  },
}));

vi.mock("../../../../shared/api/connection-catalog-api", () => ({
  connectionCatalogApi: {
    resolveDefaultTextConnectionId: hookMocks.resolveDefaultTextConnectionId,
  },
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
    hookMocks.updateMemory.mutateAsync.mockClear();
    hookMocks.invalidateMemories.mockClear();
    hookMocks.resolveDefaultTextConnectionId.mockClear();
    hookMocks.memories = [
      {
        id: "mira-memory",
        kind: "fact",
        status: "active",
        scope: { kind: "character", id: "char-1" },
        content: "Mira keeps the brass key.",
        confidence: 0.9,
        provenance: { messageIds: ["message-1"], characterId: "char-1" },
        tags: ["automatic"],
        payload: { automatic: true },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ];
    hookMocks.cleanupModalProps = null;
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

  it("marks edited automatic memories so cleanup keeps them protected", async () => {
    renderTab();
    const edit = container!.querySelector<HTMLButtonElement>('button[aria-label="Edit memory"]');
    act(() => edit?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>("article textarea");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Mira keeps the brass key in her coat.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container!.querySelector<HTMLButtonElement>('button[aria-label="Save memory"]');
    await act(async () => save?.click());

    expect(hookMocks.updateMemory.mutateAsync).toHaveBeenCalledWith({
      memoryId: "mira-memory",
      patch: {
        content: "Mira keeps the brass key in her coat.",
        payload: { automatic: true, userEdited: true },
      },
    });
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
    expect(container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]')?.value).toBe(
      "",
    );
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
    expect(container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New character memory"]')?.value).toBe(
      "Nia's separate draft.",
    );
    expect(container!.textContent).not.toContain("not ready for recall");
  });

  it("opens cleanup for only the current character and uses the default text connection", async () => {
    renderTab();
    const tidy = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Tidy memories",
    );
    expect(tidy).toBeTruthy();
    act(() => tidy?.click());

    expect(hookMocks.cleanupModalProps?.scope).toEqual({
      kind: "character",
      id: "char-1",
    });
    expect((hookMocks.cleanupModalProps?.sources as Array<{ id: string }>).map((source) => source.id)).toEqual([
      "mira-memory",
    ]);
    await (hookMocks.cleanupModalProps?.resolveConnectionId as () => Promise<string>)();
    expect(hookMocks.resolveDefaultTextConnectionId).toHaveBeenCalledOnce();
    expect(container!.querySelector('[data-testid="character-memory-cleanup"]')).toBeTruthy();
  });
});
