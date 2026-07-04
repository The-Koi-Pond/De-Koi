import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { storageApi } from "../../../../shared/api/storage-api";
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

  it("opens the character profile from the assistant name", () => {
    const onOpenCharacterProfile = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={message}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
            onOpenCharacterProfile={onOpenCharacterProfile}
          />
        </QueryClientProvider>,
      );
    });

    const profileButton = container!.querySelector<HTMLButtonElement>('button[aria-label="Open Aster profile"]');
    expect(profileButton).not.toBeNull();

    act(() => {
      profileButton!.click();
    });

    expect(onOpenCharacterProfile).toHaveBeenCalledWith(
      "character-1",
      expect.objectContaining({ width: expect.any(Number) }),
    );
  });

  it("keeps markdown blocks when fenced examples contain a known speaker prefix", () => {
    const markdownMessage: Message = {
      ...message,
      id: "message-markdown-speaker-prefix-code",
      content: [
        "## Example texting style",
        "",
        "```text",
        "Deki-senpai: Michael? Are you actually there?",
        "Michael: here",
        "```",
      ].join("\n"),
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    const dekiCharacterMap = new Map([
      [
        "character-1",
        {
          name: "Deki-senpai",
          avatarUrl: null,
        },
      ],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={markdownMessage}
            characterMap={dekiCharacterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    const heading = container!.querySelector<HTMLElement>("h2.mari-md-heading");
    const code = container!.querySelector<HTMLElement>("pre.mari-md-codeblock code");

    expect(heading?.textContent).toBe("Example texting style");
    expect(code?.textContent).toContain("Deki-senpai: Michael? Are you actually there?");
    expect(code?.textContent).toContain("Michael: here");
  });

  it("does not advertise a profile button for an orphaned assistant character ID", () => {
    const onOpenCharacterProfile = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={{ ...message, characterId: "missing-character" }}
            characterMap={characterMap}
            chatCharacterIds={["missing-character"]}
            onOpenCharacterProfile={onOpenCharacterProfile}
          />
        </QueryClientProvider>,
      );
    });

    const profileButton = container!.querySelector<HTMLButtonElement>('button[aria-label$=" profile"]');
    expect(profileButton).toBeNull();
    expect(onOpenCharacterProfile).not.toHaveBeenCalled();
  });
  it("uses the soft reveal treatment while assistant text streams", () => {
    const streamingMessage: Message = {
      ...message,
      id: "message-streaming-reveal",
      content: "The first words are here.",
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={streamingMessage}
            isStreaming
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector(".mari-streaming-reveal")).not.toBeNull();
    expect(container!.querySelector(".mari-streaming-caret")).toBeNull();
  });

  it("uses a quiet pending shimmer before streamed assistant text exists", () => {
    const pendingMessage: Message = {
      ...message,
      id: "message-streaming-pending",
      content: "",
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={pendingMessage}
            isStreaming
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector(".mari-streaming-pending")).not.toBeNull();
    expect(container!.querySelector(".mari-typing-dots")).toBeNull();
  });
  it("lets generated image attachments be removed or regenerated without deleting the message", async () => {
    const onDelete = vi.fn();
    const onIllustrateMoment = vi.fn().mockResolvedValue(undefined);
    const patchExtra = vi.spyOn(storageApi, "patchChatMessageExtra").mockResolvedValue({} as Message);
    const illustratedMessage: Message = {
      ...message,
      id: "message-illustrated",
      content: "The pond reflects the lanterns.",
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
        attachments: [
          {
            type: "image/png",
            url: "data:image/png;base64,aW1hZ2U=",
            prompt: "lantern pond",
            galleryId: "gallery-1",
          },
        ],
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={illustratedMessage}
            onDelete={onDelete}
            onIllustrateMoment={onIllustrateMoment}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Remove image"]')!.click();
      await Promise.resolve();
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(patchExtra).toHaveBeenCalledWith("message-illustrated", { attachments: [] });

    patchExtra.mockClear();
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={illustratedMessage}
            onDelete={onDelete}
            onIllustrateMoment={onIllustrateMoment}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('button[title="Regenerate image"]')!.click();
      await Promise.resolve();
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(patchExtra).toHaveBeenCalledWith("message-illustrated", { attachments: [] });
    expect(onIllustrateMoment).toHaveBeenCalledWith({
      chatId: "chat-1",
      messageId: "message-illustrated",
      role: "assistant",
      speakerName: "Aster",
      createdAt: "2026-06-19T12:00:00.000Z",
      content: "The pond reflects the lanterns.",
    });
  });

  it("labels assistant messages without a character as Assistant", () => {
    const neutralMessage: Message = {
      ...message,
      id: "message-neutral-assistant",
      characterId: null,
      content: "The scene concluded and returns to the conversation.",
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={neutralMessage}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.textContent).toContain("Assistant");
    expect(container!.textContent).not.toContain("Aster");
  });

  it("keeps character CSS hooks on grouped speaker messages", () => {
    const groupedMessage: Message = {
      ...message,
      id: "message-grouped-speakers",
      characterId: null,
      content: "Aster: hello there\nBram: pancakes?",
      extra: {
        displayText: null,
        isGenerated: true,
        tokenCount: null,
        generationInfo: null,
      },
    };
    const groupedCharacterMap = new Map([
      ...characterMap,
      [
        "character-2",
        {
          name: "Bram",
          avatarUrl: null,
        },
      ] as const,
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={groupedMessage}
            characterMap={groupedCharacterMap}
            chatCharacterIds={["character-1", "character-2"]}
          />
        </QueryClientProvider>,
      );
    });

    const asterContent = container!.querySelector<HTMLElement>('[data-card-css="character-1"] .mari-message-content');
    const bramContent = container!.querySelector<HTMLElement>('[data-card-css="character-2"] .mari-message-content');
    expect(asterContent?.textContent).toContain("hello there");
    expect(bramContent?.textContent).toContain("pancakes?");
  });
  it("keeps a visible timestamp at the top of grouped conversation messages", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ConversationMessage
            message={{
              ...message,
              id: "message-grouped-timestamp",
              content: "Still here.",
              extra: {
                displayText: null,
                isGenerated: true,
                tokenCount: null,
                generationInfo: null,
              },
            }}
            isGrouped
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    const body = container!.querySelector<HTMLElement>(".mari-message-body");
    const timestamp = container!.querySelector<HTMLElement>(".mari-message-timestamp");
    const content = container!.querySelector<HTMLElement>(".mari-message-content");

    expect(timestamp).not.toBeNull();
    expect(body).not.toBeNull();
    expect(content).not.toBeNull();
    expect(body!.contains(timestamp!)).toBe(true);
    expect(timestamp!.compareDocumentPosition(content!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
