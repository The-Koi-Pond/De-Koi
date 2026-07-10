import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationPromptSnapshot, Message } from "../../../../../engine/contracts/types/chat";
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
  it("renders persona metadata name before the timestamp in roleplay messages", () => {
    const userMessage: Message = {
      ...message,
      id: "message-user-meta",
      role: "user",
      characterId: null,
      content: "Hello from me.",
      extra: {
        displayText: null,
        isGenerated: false,
        tokenCount: null,
        generationInfo: null,
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={userMessage} chatMode="roleplay" personaInfo={{ name: "Chai" }} />
        </QueryClientProvider>,
      );
    });

    const meta = container!.querySelector<HTMLElement>(".mari-message-meta")!;
    const name = meta.querySelector<HTMLElement>(".mari-message-name")!;
    const timestamp = meta.querySelector<HTMLElement>(".mari-message-timestamp")!;
    const children = Array.from(meta.children);

    expect(name.textContent).toBe("Chai");
    expect(children.indexOf(name)).toBeLessThan(children.indexOf(timestamp));
  });

  it("ignores a character dialogue color when attribution is missing", () => {
    const coloredCharacterMap = new Map([
      [
        "character-1",
        {
          name: "Aster",
          avatarUrl: null,
          dialogueColor: "#ff3366",
        },
      ],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...message, id: "message-missing-attribution", content: 'Aster smiled. "Ready."' }}
            characterMap={coloredCharacterMap}
            chatCharacterIds={["character-1"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain('"Ready."');
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

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain(
      '"I should stay readable."',
    );
  });

  it("ignores legacy dialogue colors and attribution ids", () => {
    const content = '"First." "Second."';
    const duplicateNameMessage: Message = {
      ...message,
      id: "message-duplicate-speaker-ids",
      characterId: null,
      content,
      extra: {
        ...message.extra,
        dialogueAttributions: {
          version: 1,
          textHash: "legacy-attribution-hash",
          segments: [
            {
              start: 0,
              end: 8,
              speakerName: "Twin",
              speakerId: "char-a",
              source: "speaker-tag",
              confidence: "explicit",
            },
            {
              start: 9,
              end: 18,
              speakerName: "Twin",
              speakerId: "char-b",
              source: "speaker-tag",
              confidence: "explicit",
            },
          ],
        },
      } as unknown as Message["extra"],
    };
    const twins: CharacterMap = new Map([
      ["char-a", { name: "Twin", avatarUrl: null, dialogueColor: "#ff3366" }],
      ["char-b", { name: "Twin", avatarUrl: null, dialogueColor: "#33aaff" }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={duplicateNameMessage}
            characterMap={twins}
            chatCharacterIds={["char-a", "char-b"]}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain(content);
  });
  it("ignores legacy persona-attributed dialogue colors", () => {
    const content = '"I said it."';
    const personaAttributedMessage: Message = {
      ...message,
      id: "message-persona-attributed-dialogue",
      characterId: null,
      content,
      extra: {
        ...message.extra,
        dialogueAttributions: {
          version: 1,
          textHash: "legacy-attribution-hash",
          segments: [
            {
              start: 0,
              end: content.length,
              speakerName: "Chai",
              speakerId: "persona-1",
              source: "speaker-tag",
              confidence: "explicit",
            },
          ],
        },
      } as unknown as Message["extra"],
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={personaAttributedMessage}
            personaInfo={{ id: "persona-1", name: "Chai", dialogueColor: "#b58cff" }}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain(content);
  });

  it("warns once per chat when attributed speakers miss the color map", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = '"Boo."';
    const missingSpeakerMessage: Message = {
      ...message,
      id: "message-missing-speaker-color",
      chatId: "chat-missing-speaker-color",
      characterId: null,
      content,
      extra: {
        ...message.extra,
        dialogueAttributions: {
          version: 1,
          textHash: "legacy-attribution-hash",
          segments: [
            {
              start: 0,
              end: content.length,
              speakerName: "Ghost",
              source: "speaker-tag",
              confidence: "explicit",
            },
          ],
        },
      } as unknown as Message["extra"],
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={missingSpeakerMessage} characterMap={characterMap} chatMode="roleplay" />
        </QueryClientProvider>,
      );
    });
    act(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...missingSpeakerMessage, id: "message-missing-speaker-color-2" }}
            characterMap={characterMap}
            chatMode="roleplay"
          />
        </QueryClientProvider>,
      );
    });

    expect(warn).not.toHaveBeenCalled();
  });
  it("does not infer roleplay assistant quote colors on first render without stored attribution", () => {
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

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain('"Do not move!"');
  });
  it("does not infer configured character aliases on first render without stored attribution", () => {
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

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain('"Welcome,"');
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

    expect(container!.querySelector<HTMLElement>(".mari-message-content strong")).toBeNull();
    expect(container!.querySelector<HTMLElement>(".mari-message-content")?.textContent).toContain('"Welcome,"');
  });
  it("shows remembered and recalled memory indicators with recalled details", () => {
    const onPeekPrompt = vi.fn();
    const promptSnapshot: GenerationPromptSnapshot = {
      messages: [],
      parameters: {},
      contextAttribution: {
        source: "saved_snapshot",
        items: [
          {
            kind: "memory_recall",
            label: "Memory",
            status: "injected",
            sourceId: "memory-1",
            sourceCollection: "chat_memories",
            snippet: "Aster remembers Celia prefers concise recaps.",
          },
          {
            kind: "memory_recall",
            label: "Memory",
            status: "injected",
            sourceId: "memory-2",
            sourceCollection: "chat_memories",
            snippet: "Aster remembers the pond metaphor.",
          },
          {
            kind: "memory_recall",
            label: "Memory",
            status: "considered",
            sourceId: "memory-3",
            sourceCollection: "chat_memories",
            snippet: "Skipped memory should not count.",
          },
        ],
      },
    };
    const memoryMessage: Message = {
      ...message,
      id: "message-memory-indicators",
      extra: {
        ...message.extra,
        memoryCapture: {
          status: "completed",
          jobId: "job-1",
          sourceMessageIds: ["user-1", "message-memory-indicators"],
          completedAt: "2026-01-01T00:03:00.000Z",
        },
        generationPromptSnapshot: promptSnapshot,
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={memoryMessage} characterMap={characterMap} onPeekPrompt={onPeekPrompt} />
        </QueryClientProvider>,
      );
    });

    expect(container!.querySelector('[role="status"]')?.textContent).toContain("remembered");
    const recalledChip = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("2 memories recalled"),
    );
    expect(recalledChip).toBeTruthy();

    act(() => {
      recalledChip!.click();
    });

    expect(container!.textContent).toContain("Recalled memories");
    expect(container!.textContent).toContain("I remembered: Aster remembers Celia prefers concise recaps.");
    expect(container!.textContent).not.toContain("Skipped memory should not count.");
    expect(onPeekPrompt).not.toHaveBeenCalled();

    const peekButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Open Peek Prompt"),
    );
    act(() => {
      peekButton!.click();
    });

    expect(onPeekPrompt).toHaveBeenCalledWith({
      forCharacterId: "character-1",
      messageId: "message-memory-indicators",
      promptSnapshot,
    });
  });
});
