import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationPromptSnapshot, Message } from "../../../../../engine/contracts/types/chat";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { subscribeMergedMessageCycle } from "../lib/merged-message-cycle-clock";
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
  const cycleUnsubscribers: Array<() => void> = [];

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
    while (cycleUnsubscribers.length > 0) cycleUnsubscribers.pop()?.();
    queryClient?.clear();
    queryClient = null;
    container?.remove();
    container = null;
    resetChatMessageUiState();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("does not update merged identity opacity while the identity block is offscreen", () => {
    vi.useFakeTimers();
    const unsubscribeVisibleKeeper = subscribeMergedMessageCycle(vi.fn());
    cycleUnsubscribers.push(unsubscribeVisibleKeeper);
    vi.advanceTimersByTime(2_000);
    let observerCallback: IntersectionObserverCallback | null = null;
    let observer: IntersectionObserver | null = null;
    const captureObserver = (value: IntersectionObserver) => {
      observer = value;
    };
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
        captureObserver(this);
      }
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const groupCharacterMap: CharacterMap = new Map([
      ["aster", { name: "Aster", avatarUrl: "asset://aster", nameColor: "#ff0000" }],
      ["briar", { name: "Briar", avatarUrl: "asset://briar", nameColor: "#00ff00" }],
      ["cinder", { name: "Cinder", avatarUrl: "asset://cinder", nameColor: "#0000ff" }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...message, id: "message-offscreen-cycle", characterId: null }}
            chatMode="roleplay"
            groupChatMode="merged"
            characterMap={groupCharacterMap}
            chatCharacterIds={["aster", "briar", "cinder"]}
          />
        </QueryClientProvider>,
      );
    });

    expect(observer).not.toBeNull();
    const identityBlock = container!.querySelector<HTMLElement>("[data-cycle-name]")?.parentElement;
    expect(observer!.observe as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(identityBlock);
    act(() => {
      observerCallback!([{ isIntersecting: false } as IntersectionObserverEntry], observer!);
      vi.advanceTimersByTime(2_000);
    });

    const names = container!.querySelectorAll<HTMLElement>("[data-cycle-name]");
    expect(Array.from(names, (name) => name.style.opacity)).toEqual(["1", "0", "0"]);

    unsubscribeVisibleKeeper();
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      observerCallback!([{ isIntersecting: true } as IntersectionObserverEntry], observer!);
      vi.advanceTimersByTime(2_000);
    });
    expect(Array.from(names, (name) => name.style.opacity)).toEqual(["0", "1", "0"]);
  });

  it("replaces the observed merged identity target when grouping changes the render path", () => {
    vi.useFakeTimers();
    const observers: Array<{
      callback: IntersectionObserverCallback;
      observer: IntersectionObserver;
    }> = [];
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, observer: this });
      }
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const groupCharacterMap: CharacterMap = new Map([
      ["aster", { name: "Aster", avatarUrl: "asset://aster", nameColor: "#ff0000" }],
      ["briar", { name: "Briar", avatarUrl: "asset://briar", nameColor: "#00ff00" }],
    ]);
    const renderMessage = (isGrouped: boolean) => (
      <QueryClientProvider client={queryClient!}>
        <ChatMessage
          message={{ ...message, id: "message-replaced-cycle-target", characterId: null }}
          chatMode="roleplay"
          groupChatMode="merged"
          characterMap={groupCharacterMap}
          chatCharacterIds={["aster", "briar"]}
          isGrouped={isGrouped}
        />
      </QueryClientProvider>
    );

    act(() => {
      root = createRoot(container!);
      root.render(renderMessage(false));
    });
    expect(observers).toHaveLength(1);
    const firstTarget = container!.querySelector<HTMLElement>("[data-cycle-name]")!.parentElement!;
    expect(observers[0]!.observer.observe as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(firstTarget);

    act(() => {
      root!.render(renderMessage(true));
    });
    expect(observers[0]!.observer.disconnect).toHaveBeenCalledOnce();

    act(() => {
      root!.render(renderMessage(false));
    });
    expect(observers).toHaveLength(2);
    const secondTarget = container!.querySelector<HTMLElement>("[data-cycle-name]")!.parentElement!;
    expect(secondTarget).not.toBe(firstTarget);
    expect(observers[1]!.observer.observe as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(secondTarget);

    act(() => {
      observers[1]!.callback(
        [{ target: secondTarget, isIntersecting: false } as unknown as IntersectionObserverEntry],
        observers[1]!.observer,
      );
      vi.advanceTimersByTime(2_000);
    });
    const names = secondTarget.querySelectorAll<HTMLElement>("[data-cycle-name]");
    expect(Array.from(names, (name) => name.style.opacity)).toEqual(["1", "0"]);
  });

  it("ignores a stale intersecting callback after its identity target is unmounted", () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    let observerCallback: IntersectionObserverCallback | null = null;
    let observer: IntersectionObserver | null = null;
    const captureObserver = (value: IntersectionObserver) => {
      observer = value;
    };
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
        captureObserver(this);
      }
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const groupCharacterMap: CharacterMap = new Map([
      ["aster", { name: "Aster", avatarUrl: "asset://aster", nameColor: "#ff0000" }],
      ["briar", { name: "Briar", avatarUrl: "asset://briar", nameColor: "#00ff00" }],
    ]);
    const renderMessage = (isGrouped: boolean) => (
      <QueryClientProvider client={queryClient!}>
        <ChatMessage
          message={{ ...message, id: "message-stale-cycle-target", characterId: null }}
          chatMode="roleplay"
          groupChatMode="merged"
          characterMap={groupCharacterMap}
          chatCharacterIds={["aster", "briar"]}
          isGrouped={isGrouped}
        />
      </QueryClientProvider>
    );

    act(() => {
      root = createRoot(container!);
      root.render(renderMessage(false));
    });
    const staleTarget = container!.querySelector<HTMLElement>("[data-cycle-name]")!.parentElement!;
    act(() => {
      observerCallback!(
        [{ target: staleTarget, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer!,
      );
      vi.advanceTimersByTime(2_000);
    });
    const staleNames = staleTarget.querySelectorAll<HTMLElement>("[data-cycle-name]");
    expect(Array.from(staleNames, (name) => name.style.opacity)).toEqual(["0", "1"]);

    act(() => {
      root!.render(renderMessage(true));
    });
    expect(observer!.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const visibilityAddsBeforeStaleCallback = addEventListener.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange",
    ).length;
    const visibilityRemovesBeforeStaleCallback = removeEventListener.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange",
    ).length;
    expect(visibilityRemovesBeforeStaleCallback).toBe(visibilityAddsBeforeStaleCallback);

    act(() => {
      observerCallback!(
        [{ target: staleTarget, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer!,
      );
    });
    const timerCountAfterStaleCallback = vi.getTimerCount();
    const visibilityAddsAfterStaleCallback = addEventListener.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange",
    ).length;
    const visibilityRemovesAfterStaleCallback = removeEventListener.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange",
    ).length;
    const staleOpacityAfterCallback = Array.from(staleNames, (name) => name.style.opacity);

    act(() => {
      observerCallback!(
        [{ target: staleTarget, isIntersecting: false } as unknown as IntersectionObserverEntry],
        observer!,
      );
    });

    expect(timerCountAfterStaleCallback).toBe(0);
    expect(visibilityAddsAfterStaleCallback).toBe(visibilityAddsBeforeStaleCallback);
    expect(visibilityRemovesAfterStaleCallback).toBe(visibilityRemovesBeforeStaleCallback);
    expect(staleOpacityAfterCallback).toEqual(["0", "1"]);
  });

  it("derives different participant totals from the shared tick when observers are unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const twoCharacters: CharacterMap = new Map([
      ["aster", { name: "Aster", avatarUrl: "asset://aster", nameColor: "#ff0000" }],
      ["briar", { name: "Briar", avatarUrl: "asset://briar", nameColor: "#00ff00" }],
    ]);
    const threeCharacters: CharacterMap = new Map([
      ...twoCharacters,
      ["cinder", { name: "Cinder", avatarUrl: "asset://cinder", nameColor: "#0000ff" }],
    ]);

    const renderMessages = (includeSecond: boolean) => (
      <StrictMode>
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            key="two"
            message={{ ...message, id: "message-cycle-two", characterId: null }}
            chatMode="roleplay"
            groupChatMode="merged"
            characterMap={twoCharacters}
            chatCharacterIds={["aster", "briar"]}
          />
          {includeSecond && (
            <ChatMessage
              key="three"
              message={{ ...message, id: "message-cycle-three", characterId: null }}
              chatMode="roleplay"
              groupChatMode="merged"
              characterMap={threeCharacters}
              chatCharacterIds={["aster", "briar", "cinder"]}
            />
          )}
        </QueryClientProvider>
      </StrictMode>
    );

    act(() => {
      root = createRoot(container!);
      root.render(renderMessages(false));
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    act(() => {
      root!.render(renderMessages(true));
    });
    const lateNames = container!.querySelectorAll<HTMLElement>(
      '[data-message-id="message-cycle-three"] [data-cycle-name]',
    );
    expect(Array.from(lateNames, (name) => name.style.opacity)).toEqual(["0", "1", "0"]);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    const firstNames = container!.querySelectorAll<HTMLElement>(
      '[data-message-id="message-cycle-two"] [data-cycle-name]',
    );
    const secondNames = container!.querySelectorAll<HTMLElement>(
      '[data-message-id="message-cycle-three"] [data-cycle-name]',
    );
    expect(Array.from(firstNames, (name) => name.style.opacity)).toEqual(["1", "0"]);
    expect(Array.from(secondNames, (name) => name.style.opacity)).toEqual(["0", "0", "1"]);
  });

  it("defers immediate phase writes while hidden and synchronizes on visibility resume", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    const unsubscribeVisibleKeeper = subscribeMergedMessageCycle(vi.fn());
    cycleUnsubscribers.push(unsubscribeVisibleKeeper);
    vi.advanceTimersByTime(2_000);
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    const groupCharacterMap: CharacterMap = new Map([
      ["aster", { name: "Aster", avatarUrl: "asset://aster", nameColor: "#ff0000" }],
      ["briar", { name: "Briar", avatarUrl: "asset://briar", nameColor: "#00ff00" }],
      ["cinder", { name: "Cinder", avatarUrl: "asset://cinder", nameColor: "#0000ff" }],
    ]);

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...message, id: "message-hidden-phase", characterId: null }}
            chatMode="roleplay"
            groupChatMode="merged"
            characterMap={groupCharacterMap}
            chatCharacterIds={["aster", "briar", "cinder"]}
          />
        </QueryClientProvider>,
      );
    });

    const names = container!.querySelectorAll<HTMLElement>("[data-cycle-name]");
    expect(Array.from(names, (name) => name.style.opacity)).toEqual(["1", "0", "0"]);

    act(() => {
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(Array.from(names, (name) => name.style.opacity)).toEqual(["0", "1", "0"]);
    unsubscribeVisibleKeeper();
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
          capture: {
            operation: "created",
            memory: { id: "memory-1", content: "Celia prefers concise recaps." },
          },
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

    const rememberedChip = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("remembered"),
    );
    expect(rememberedChip).toBeTruthy();
    act(() => rememberedChip!.click());
    expect(container!.textContent).toContain("Saved memory");
    expect(container!.textContent).toContain("Celia prefers concise recaps.");
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

  it("does not claim a memory was remembered when completed capture details are missing", () => {
    const legacyCompletedMessage: Message = {
      ...message,
      id: "message-memory-capture-without-details",
      extra: {
        ...message.extra,
        memoryCapture: {
          status: "completed",
          jobId: "legacy-job",
          sourceMessageIds: ["user-legacy", "message-memory-capture-without-details"],
          completedAt: "2026-01-01T00:03:00.000Z",
        },
      },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={legacyCompletedMessage} characterMap={characterMap} />
        </QueryClientProvider>,
      );
    });

    expect(
      Array.from(container!.querySelectorAll("button")).find((button) => button.textContent?.includes("remembered")),
    ).toBeUndefined();
    expect(container!.textContent).not.toContain("Saved memory details are unavailable");
  });

  it("does not throw or show remembered for a malformed capture without memory data", () => {
    const malformedCaptureMessage = {
      ...message,
      id: "message-malformed-memory-capture",
      extra: {
        ...message.extra,
        memoryCapture: {
          status: "completed",
          jobId: "malformed-job",
          sourceMessageIds: ["user-malformed", "message-malformed-memory-capture"],
          completedAt: "2026-01-01T00:03:00.000Z",
          capture: { operation: "created" },
        },
      },
    } as unknown as Message;

    expect(() => {
      act(() => {
        root = createRoot(container!);
        root.render(
          <QueryClientProvider client={queryClient!}>
            <ChatMessage message={malformedCaptureMessage} characterMap={characterMap} />
          </QueryClientProvider>,
        );
      });
    }).not.toThrow();
    expect(container!.textContent).not.toContain("remembered");
  });

  it("shows provider reasoning inline only when enabled and omits empty panels", () => {
    const reasoningMessage: Message = {
      ...message,
      id: "roleplay-reasoning",
      extra: { ...message.extra, reasoning_content: "Compared the available clues." },
    };

    act(() => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage message={reasoningMessage} characterMap={characterMap} showInlineReasoning />
        </QueryClientProvider>,
      );
    });
    expect(container!.textContent).toContain("Model reasoning");
    expect(container!.textContent).toContain("Compared the available clues.");

    act(() => {
      root!.render(
        <QueryClientProvider client={queryClient!}>
          <ChatMessage
            message={{ ...reasoningMessage, extra: message.extra }}
            characterMap={characterMap}
            showInlineReasoning
          />
        </QueryClientProvider>,
      );
    });
    expect(container!.textContent).not.toContain("Model reasoning");
  });
});
