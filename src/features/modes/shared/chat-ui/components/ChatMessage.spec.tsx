import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../../engine/contracts/types/chat";
import { ChatMessage } from "./ChatMessage";

const message: Message = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant",
  characterId: "character-1",
  content: "Hello there.",
  activeSwipeIndex: 0,
  swipeCount: 1,
  createdAt: "2026-06-19T12:00:00.000Z",
  extra: {
    displayText: null,
    isGenerated: true,
    tokenCount: null,
    generationInfo: null,
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

describe("ChatMessage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it("opens the character profile from the assistant name", () => {
    const onOpenCharacterProfile = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
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
  it("renders merged group names as plain text instead of a dead profile button", () => {
    const onOpenCharacterProfile = vi.fn();
    const groupCharacterMap = new Map([
      ...characterMap,
      [
        "character-2",
        {
          name: "Briar",
          avatarUrl: null,
        },
      ],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={message}
            characterMap={groupCharacterMap}
            chatCharacterIds={["character-1", "character-2"]}
            groupChatMode="merged"
            onOpenCharacterProfile={onOpenCharacterProfile}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector<HTMLButtonElement>('button[aria-label$=" profile"]')).toBeNull();
    const mergedName = container!.querySelector<HTMLElement>(".mari-message-name");
    expect(mergedName).not.toBeNull();
    expect(mergedName!.className).toContain("cursor-default");

    expect(onOpenCharacterProfile).not.toHaveBeenCalled();
  });
});
