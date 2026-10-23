import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callState = vi.hoisted(() => ({
  heard: "",
  said: "",
  reaction: { activity: "speaking", expression: "happy" },
  sprites: [] as Array<{ expression: string; url: string }>,
}));

vi.mock("../hooks/use-voice-call", () => ({
  useVoiceCall: () => ({
    phase: "speaking",
    level: 0,
    heard: callState.heard,
    said: callState.said,
    error: null,
    muted: false,
    toggleMute: vi.fn(),
    voiceReplies: true,
    mic: "listening",
    destination: "ElevenLabs",
    bargeIn: "voice",
    stopping: false,
    sessionId: 1,
    reaction: callState.reaction,
    hangUp: vi.fn(),
    interrupt: vi.fn(),
  }),
}));

vi.mock("../../../catalog/sprites/index", () => ({
  useSprites: () => ({ data: callState.sprites }),
}));

vi.mock("../../shared/chat-ui/index", () => ({
  useReplyWait: () => ({ elapsed: null, slow: false }),
}));

import { VoiceCallOverlay } from "./VoiceCallOverlay";

const LONG_REPLY = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} about the gravy machine.`).join(" ");

describe("VoiceCallOverlay transcript", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    callState.heard = "Freddy, how's the gravy today?";
    callState.said = LONG_REPLY;
    callState.reaction = { activity: "speaking", expression: "happy" };
    callState.sprites = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(
        <VoiceCallOverlay
          chatId="chat-1"
          character={{ id: "character-1", name: "Gravy Freddy" } as never}
          sendText={async () => true}
          onClose={() => {}}
        />,
      );
    });
  }

  it("shows the whole reply in a scrolling box instead of cutting it off", () => {
    render();
    const box = container.querySelector<HTMLElement>('[data-testid="voice-call-transcript"]')!;
    expect(box.className).toContain("overflow-y-auto");
    expect(box.textContent).toContain("Sentence 12 about the gravy machine.");
    expect(container.querySelector('[class*="line-clamp"]')).toBeNull();
  });

  it("follows the newest words while the reply streams in", () => {
    render();
    const box = container.querySelector<HTMLElement>('[data-testid="voice-call-transcript"]')!;
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 900 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 300 });
    callState.said = `${LONG_REPLY} One more line.`;
    render();
    expect(box.scrollTop).toBe(900);
  });

  it("stays put when the user scrolls up to reread", () => {
    render();
    const box = container.querySelector<HTMLElement>('[data-testid="voice-call-transcript"]')!;
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 900 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 300 });
    box.scrollTop = 100;
    act(() => {
      box.dispatchEvent(new Event("scroll"));
    });
    callState.said = `${LONG_REPLY} One more line.`;
    render();
    expect(box.scrollTop).toBe(100);
  });

  it("shows the character's sprite for the call's reaction, and the avatar when there are no sprites", () => {
    render();
    expect(container.querySelector('[data-testid="voice-call-face"]')).toBeNull();

    callState.sprites = [
      { expression: "neutral", url: "neutral.png" },
      { expression: "happy", url: "happy.png" },
      { expression: "full_happy", url: "full-happy.png" },
    ];
    render();
    const face = () => container.querySelector<HTMLImageElement>('[data-testid="voice-call-face"]');
    expect(face()?.getAttribute("src")).toBe("happy.png");

    // No "thinking" sprite: the neutral one, never a full-body pose in the call's face.
    callState.reaction = { activity: "thinking", expression: "thinking" };
    render();
    expect(face()?.getAttribute("src")).toBe("neutral.png");
    expect(face()?.dataset.activity).toBe("thinking");
  });
});
