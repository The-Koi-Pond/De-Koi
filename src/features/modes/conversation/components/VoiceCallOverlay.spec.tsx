import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callState = vi.hoisted(() => ({
  heard: "",
  said: "",
}));

vi.mock("../hooks/use-voice-call", () => ({
  useVoiceCall: () => ({
    phase: "speaking",
    level: 0,
    heard: callState.heard,
    said: callState.said,
    error: null,
    muted: false,
    setMuted: vi.fn(),
    voiceReplies: true,
    hangUp: vi.fn(),
    interrupt: vi.fn(),
  }),
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
          sendText={async () => undefined}
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
});
