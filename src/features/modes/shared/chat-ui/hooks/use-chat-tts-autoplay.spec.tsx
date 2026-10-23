import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { speakSequence } = vi.hoisted(() => ({ speakSequence: vi.fn(async () => undefined) }));

vi.mock("../../../../../shared/hooks/use-tts", () => ({
  useTTSConfig: () => ({
    data: { enabled: true, autoplayConvo: true, autoplayRP: false, autoplayStreaming: false, voiceMode: "single" },
  }),
}));
vi.mock("../../../../../shared/lib/tts-service", () => ({ ttsService: { speakSequence } }));
vi.mock("../../../../../shared/lib/tts-dialogue", () => ({
  buildTTSVoiceRequests: (text: string) => [{ text }],
  clientSidePlaybackRate: () => 1,
  normalizeTTSCharacterName: (name: string | null | undefined) => (name ?? "").toLowerCase(),
  withTTSVoiceRequestCacheKeys: (requests: unknown) => requests,
}));
vi.mock("../../../../../shared/stores/chat.store", () => ({
  useChatStore: (select: (state: { streamingCharacterId: null; typingCharacterName: null }) => unknown) =>
    select({ streamingCharacterId: null, typingCharacterName: null }),
}));
vi.mock("./use-streaming-tts", () => ({ useStreamingTTS: () => undefined }));

import { holdChatAutoplay } from "../../../../../shared/lib/chat-autoplay-hold";
import { useChatTtsAutoplay } from "./use-chat-tts-autoplay";

const messages = [{ id: "m1", role: "assistant", content: "Gravy is lumpy today.", characterId: null }] as never;

function Harness({ isStreaming }: { isStreaming: boolean }) {
  useChatTtsAutoplay({ chatId: "chat-1", mode: "conversation", messages, characterMap: new Map(), isStreaming });
  return null;
}

describe("useChatTtsAutoplay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    speakSequence.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function finishAReply() {
    act(() => root.render(<Harness isStreaming />));
    act(() => root.render(<Harness isStreaming={false} />));
  }

  it("reads a finished reply aloud", () => {
    finishAReply();
    expect(speakSequence).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while a voice call holds the chat (the call speaks the reply itself)", () => {
    const release = holdChatAutoplay("chat-1");
    finishAReply();
    expect(speakSequence).not.toHaveBeenCalled();
    release();
  });

  it("only the held chat is quiet", () => {
    const release = holdChatAutoplay("another-chat");
    finishAReply();
    expect(speakSequence).toHaveBeenCalledTimes(1);
    release();
  });
});
