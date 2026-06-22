import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { ConversationMessage } from "./ConversationMessage";

const message: Message = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant",
  characterId: "character-1",
  content: "Hidden content",
  activeSwipeIndex: 0,
  swipeCount: 1,
  createdAt: "2026-06-19T12:00:00.000Z",
  extra: {
    displayText: null,
    isGenerated: true,
    tokenCount: null,
    generationInfo: null,
    hiddenFromAI: true,
  },
};

const characterMap = new Map([
  [
    "character-1",
    {
      name: "Aster",
      avatarUrl: null,
    },
  ],
]);

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(textarea, value);
}

function resetConversationUiState() {
  useUIStore.setState((state) => ({
    chatFontSize: 16,
    showMessageNumbers: false,
    guideGenerations: false,
    editMessagesOnDoubleClick: true,
    quoteFormat: "straight",
    summaryPopoverSettings: {
      ...state.summaryPopoverSettings,
      collapseHiddenMessages: false,
    },
  }));
}

describe("ConversationMessage memo subscriptions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    resetConversationUiState();
    queryClient = new QueryClient();
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
    queryClient?.clear();
    queryClient = null;
    container?.remove();
    container = null;
    resetConversationUiState();
    vi.restoreAllMocks();
  });

  it("repaints store-selected UI state while props stay referentially stable", () => {
    const onRegenerate = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={message}
            onRegenerate={onRegenerate}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
            messageIndex={7}
          />
        </QueryClientProvider>,
      );
    });

    const content = () => container!.querySelector<HTMLElement>(".mari-message-content");

    expect(content()?.style.fontSize).toBe("16px");
    expect(container!.textContent).not.toContain("#7");
    expect(container!.querySelector('button[title="Regenerate"]')).not.toBeNull();
    expect(container!.textContent).toContain("Hidden content");

    act(() => {
      useUIStore.getState().setChatFontSize(19);
    });
    expect(content()?.style.fontSize).toBe("19px");

    act(() => {
      useUIStore.getState().setShowMessageNumbers(true);
    });
    expect(container!.textContent).toContain("#7");

    act(() => {
      useUIStore.getState().setGuideGenerations(true);
    });
    expect(container!.querySelector('button[title="Regenerate (guided)"]')).not.toBeNull();

    act(() => {
      useUIStore.getState().setSummaryPopoverSettings({ collapseHiddenMessages: true });
    });
    expect(container!.textContent).not.toContain("Hidden content");
    expect(container!.querySelector('button[aria-label="Expand hidden from AI message"]')).not.toBeNull();
  });

  it("formats message edits with the quote preference while preserving selection", async () => {
    const onEdit = vi.fn();
    const editableMessage: Message = {
      ...message,
      id: "message-edit",
      content: '"hello"',
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      useUIStore.getState().setQuoteFormat("typographic");
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={editableMessage}
            onEdit={onEdit}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    act(() => {
      container!
        .querySelector<HTMLElement>(".mari-message-content")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea.value).toBe("\u201chello\u201d");

    act(() => {
      setTextareaValue(textarea, '"world"');
      textarea.setSelectionRange(1, 6, "backward");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(textarea.value).toBe("\u201cworld\u201d");
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(6);
    expect(textarea.selectionDirection).toBe("backward");

    const saveButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "save",
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(onEdit).toHaveBeenCalledWith("message-edit", "\u201cworld\u201d");
  });

  it("formats rendered conversation text with the quote preference", () => {
    const renderedMessage: Message = {
      ...message,
      id: "message-render",
      content: '"hello"',
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      useUIStore.getState().setQuoteFormat("typographic");
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={renderedMessage}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.textContent).toContain("\u201chello\u201d");
  });

  it("keeps child button keyboard events isolated from message-level toggles", () => {
    const onRegenerate = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={{
              ...message,
              id: "message-keyboard-actions",
              extra: {
                displayText: null,
                isGenerated: true,
                tokenCount: null,
                generationInfo: null,
              },
            }}
            onRegenerate={onRegenerate}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    const messageRow = container!.querySelector<HTMLElement>(".mari-message")!;
    expect(container!.querySelector<HTMLElement>(".mari-message-actions")?.hasAttribute("aria-hidden")).toBe(false);
    const regenerateButton = container!.querySelector<HTMLButtonElement>('button[title="Regenerate"]')!;
    expect(regenerateButton.tabIndex).toBe(-1);

    act(() => {
      messageRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(regenerateButton.tabIndex).toBe(0);

    act(() => {
      regenerateButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(regenerateButton.tabIndex).toBe(0);

    act(() => {
      regenerateButton.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    expect(regenerateButton.tabIndex).toBe(0);

    act(() => {
      regenerateButton.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith("message-keyboard-actions");
  });

  it("keeps multi-select checkbox keyboard events from double toggling selection", () => {
    const onToggleSelect = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={{
              ...message,
              id: "message-keyboard-select",
              extra: {
                displayText: null,
                isGenerated: true,
                tokenCount: null,
                generationInfo: null,
              },
            }}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
            messageOrderIndex={4}
            multiSelectMode
            isSelected={false}
            onToggleSelect={onToggleSelect}
          />
        </QueryClientProvider>,
      );
    });

    const messageRow = container!.querySelector<HTMLElement>(".mari-message")!;
    act(() => {
      messageRow.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, shiftKey: true }),
      );
    });
    expect(onToggleSelect).toHaveBeenCalledWith({
      messageId: "message-keyboard-select",
      orderIndex: 4,
      checked: true,
      shiftKey: true,
    });

    onToggleSelect.mockClear();
    const checkbox = container!.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    act(() => {
      checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    expect(onToggleSelect).not.toHaveBeenCalled();

    act(() => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    });
    expect(onToggleSelect).toHaveBeenCalledWith({
      messageId: "message-keyboard-select",
      orderIndex: 4,
      checked: true,
      shiftKey: true,
    });
  });
});
