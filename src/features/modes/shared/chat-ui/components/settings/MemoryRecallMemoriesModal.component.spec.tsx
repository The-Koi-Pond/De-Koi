import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryRecallMemoriesModal } from "./MemoryRecallMemoriesModal";

const hookMocks = vi.hoisted(() => ({
  createMemory: {
    mutateAsync: vi.fn(async () => ({
      id: "memory-new",
      chatId: "chat-1",
      content: "The ferry leaves before dawn.",
    })),
    isPending: false,
  },
}));

function mutation() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
}

vi.mock("../../../../../catalog/chats/index", () => ({
  useChatMemories: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useInheritedCharacterMemories: () => ({ data: [], isLoading: false, error: null }),
  useCreateChatMemory: () => hookMocks.createMemory,
  useSoftDeleteChatMemory: mutation,
  useRestoreChatMemory: mutation,
  useUpdateChatMemory: mutation,
  usePinChatMemory: mutation,
  useCorrectChatMemory: mutation,
  useClearChatMemories: mutation,
  useRefreshChatMemories: mutation,
  useExportChatMemories: mutation,
  useImportChatMemories: mutation,
}));

vi.mock("../../../../../../shared/components/ui/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

vi.mock("../../../../../../shared/stores/ui.store", () => ({
  useUIStore: (selector: (state: { openCharacterDetail: () => void }) => unknown) =>
    selector({ openCharacterDetail: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("MemoryRecallMemoriesModal manual entry", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    hookMocks.createMemory.mutateAsync.mockClear();
    act(() => {
      root = createRoot(container!);
      root.render(<MemoryRecallMemoriesModal chatId="chat-1" open onClose={vi.fn()} />);
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("adds a trimmed memory local to the current chat", async () => {
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    expect(newMemory).toBeTruthy();
    expect(newMemory?.getAttribute("aria-expanded")).toBe("false");
    expect(newMemory?.getAttribute("aria-controls")).toBeTruthy();
    act(() => newMemory?.click());
    expect(newMemory?.getAttribute("aria-expanded")).toBe("true");

    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]');
    expect(textarea?.closest("[id]")?.id).toBe(newMemory?.getAttribute("aria-controls"));
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );
    expect(textarea).toBeTruthy();
    expect(save).toBeTruthy();

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "  The ferry leaves before dawn.  ",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save?.click());

    expect(hookMocks.createMemory.mutateAsync).toHaveBeenCalledWith("The ferry leaves before dawn.");
  });

  it("does not submit an empty chat memory", async () => {
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

  it("does not carry an unsaved draft into another chat", () => {
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Only chat one should see this.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      root?.render(<MemoryRecallMemoriesModal chatId="chat-2" open onClose={vi.fn()} />);
    });

    const nextNewMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    expect(nextNewMemory?.getAttribute("aria-expanded")).toBe("false");
    act(() => nextNewMemory?.click());
    expect(
      container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]')?.value,
    ).toBe("");
  });

  it("does not apply a completed save to a chat opened while the request was pending", async () => {
    let finishSave!: (value: { id: string; chatId: string; content: string }) => void;
    hookMocks.createMemory.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const newMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => newMemory?.click());
    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Only chat one should save this.",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save memory",
    );
    act(() => save?.click());

    act(() => {
      root?.render(<MemoryRecallMemoriesModal chatId="chat-2" open onClose={vi.fn()} />);
    });
    const nextNewMemory = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New memory",
    );
    act(() => nextNewMemory?.click());
    const nextTextarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        nextTextarea,
        "Chat two's separate draft.",
      );
      nextTextarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      finishSave({ id: "memory-new", chatId: "chat-1", content: "Only chat one should save this." }),
    );

    expect(nextNewMemory?.getAttribute("aria-expanded")).toBe("true");
    expect(container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="New chat memory"]')?.value)
      .toBe("Chat two's separate draft.");
  });
});
