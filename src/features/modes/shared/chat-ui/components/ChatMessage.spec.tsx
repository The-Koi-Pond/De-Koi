import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../../engine/contracts/types/chat";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import type { CharacterMap } from "../types";
import { ChatMessage } from "./ChatMessage";

vi.mock("./ResolvedAvatarImage", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ResolvedAvatarImage: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function MockResolvedAvatarImage(
      { crop, src, className },
      ref,
    ) {
      return (
        <img
          ref={ref}
          src={typeof src === "string" ? src : undefined}
          alt=""
          data-resolved-avatar="true"
          data-crop={JSON.stringify(crop ?? null)}
          data-class-name={typeof className === "string" ? className : ""}
        />
      );
    }),
  };
});

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

function resetChatMessageUiState() {
  useUIStore.setState({
    roleplayAvatarStyle: "circles",
    roleplayAvatarScale: 1,
    chatFontSize: 16,
    showMessageNumbers: false,
    guideGenerations: false,
    boldDialogue: true,
    quoteFormat: "straight",
    summaryPopoverSettings: {
      ...useUIStore.getState().summaryPopoverSettings,
      collapseHiddenMessages: false,
    },
  });
}

describe("ChatMessage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetChatMessageUiState();
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
    resetChatMessageUiState();
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
  it("keeps a visible timestamp at the top of grouped roleplay messages", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...message, id: "message-grouped-timestamp", content: "Still here." }}
            characterMap={characterMap}
            chatCharacterIds={["character-1"]}
            isGrouped
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
  it("keeps saved crops on compact merged roleplay avatars", () => {
    const avatarCrop = { srcX: 0.2, srcY: 0.1, srcWidth: 0.5, srcHeight: 0.5 };
    const groupCharacterMap: CharacterMap = new Map([
      [
        "mira",
        {
          name: "Mira Vale",
          avatarUrl: "asset://mira",
          avatarCrop,
        },
      ],
      [
        "orin",
        {
          name: "Orin",
          avatarUrl: "asset://orin",
          avatarCrop: null,
        },
      ],
    ]);

    act(() => {
      useUIStore.getState().setRoleplayAvatarStyle("rectangles");
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...message, id: "message-merged-avatar", characterId: null }}
            chatMode="roleplay"
            groupChatMode="merged"
            characterMap={groupCharacterMap}
            chatCharacterIds={["mira", "orin"]}
          />
        </QueryClientProvider>,
      );
    });

    const avatars = container!.querySelectorAll<HTMLImageElement>("[data-resolved-avatar='true']");

    expect(avatars).toHaveLength(2);
    expect(avatars[0]?.dataset.crop).toBe(JSON.stringify(avatarCrop));
    expect(avatars[0]?.dataset.className).toContain("object-cover");
  });

  it("does not apply persona dialogue color to user-authored quotes", () => {
    const userMessage: Message = {
      ...message,
      id: "message-user-dialogue-color",
      role: "user",
      characterId: null,
      content: '"I should stay readable."',
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={userMessage} personaInfo={{ name: "Chai", dialogueColor: "#b58cff" }} />
        </QueryClientProvider>,
      );
    });

    const quote = container!.querySelector<HTMLElement>(".mari-message-content strong");
    expect(quote?.textContent).toBe('"I should stay readable."');
    expect(quote?.style.color).toBe("");
  });

  it("colors roleplay assistant quote-first attribution by the speaking character", () => {
    const attributedMessage: Message = {
      ...message,
      id: "message-roleplay-attributed-dialogue",
      characterId: null,
      content: '"Ah. \'Technical specifications,\'" Mira Vale repeated. "Do not move!" Orin cried out.',
    };
    const roleplayCharacters: CharacterMap = new Map([
      ["mira", { name: "Mira Vale", avatarUrl: null, dialogueColor: "#b58cff" }],
      ["orin", { name: "Orin", avatarUrl: null, dialogueColor: "#f2c14e" }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={attributedMessage}
            characterMap={roleplayCharacters}
            chatCharacterIds={["mira", "orin"]}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    const quotes = Array.from(container!.querySelectorAll<HTMLElement>(".mari-message-content strong"));
    expect(quotes.map((quote) => [quote.textContent, quote.style.color])).toEqual([
      ["\"Ah. 'Technical specifications,'\"", "rgb(181, 140, 255)"],
      ['"Do not move!"', "rgb(242, 193, 78)"],
    ]);
  });
  it("colors configured character aliases without hardcoded scene names", () => {
    const aliasMessage: Message = {
      ...message,
      id: "message-roleplay-alias-dialogue",
      characterId: null,
      content: '"Welcome," the archivist said.',
    };
    const roleplayCharacters: CharacterMap = new Map([
      ["mira", { name: "Mira Vale", avatarUrl: null, dialogueColor: "#b58cff", speakerAliases: ["the archivist"] }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={aliasMessage}
            characterMap={roleplayCharacters}
            chatCharacterIds={["mira"]}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    const quote = container!.querySelector<HTMLElement>(".mari-message-content strong");
    expect(quote?.textContent).toBe('"Welcome,"');
    expect(quote?.style.color).toBe("rgb(181, 140, 255)");
  });

  it("does not color unconfigured character titles", () => {
    const aliasMessage: Message = {
      ...message,
      id: "message-roleplay-unconfigured-title",
      characterId: null,
      content: '"Welcome," the archivist said.',
    };
    const roleplayCharacters: CharacterMap = new Map([
      ["mira", { name: "Mira Vale", avatarUrl: null, dialogueColor: "#b58cff" }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={aliasMessage}
            characterMap={roleplayCharacters}
            chatCharacterIds={["mira"]}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    const quote = container!.querySelector<HTMLElement>(".mari-message-content strong");
    expect(quote?.textContent).toBe('"Welcome,"');
    expect(quote?.style.color).toBe("");
  });
});
