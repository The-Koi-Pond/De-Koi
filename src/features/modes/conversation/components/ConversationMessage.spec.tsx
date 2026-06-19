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

function resetConversationUiState() {
  useUIStore.setState((state) => ({
    chatFontSize: 16,
    showMessageNumbers: false,
    guideGenerations: false,
    editMessagesOnDoubleClick: true,
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
});
