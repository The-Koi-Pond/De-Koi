import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/use-voice-call", () => ({
  useVoiceCall: () => ({
    phase: "speaking",
    level: 0,
    heard: "Freddy, how's the gravy today?",
    said: "Lumpy, as always.",
    error: null,
    muted: false,
    toggleMute: vi.fn(),
    voiceReplies: true,
    mic: "listening",
    destination: "ElevenLabs",
    bargeIn: "voice",
    stopping: false,
    sessionId: 1,
    hangUp: vi.fn(),
    interrupt: vi.fn(),
  }),
}));

vi.mock("../../shared/chat-ui/index", () => ({
  useReplyWait: () => ({ elapsed: null, slow: false }),
}));

import { playNotificationPing } from "../../../../shared/lib/notification-sound";
import { VoiceCallOverlay } from "./VoiceCallOverlay";

// The new-message chirp used to play over the character's spoken reply during a voice call.
describe("VoiceCallOverlay notification sounds", () => {
  let container: HTMLDivElement;
  let root: Root;
  const play = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    play.mockClear();
    vi.stubGlobal(
      "Audio",
      class {
        preload = "";
        volume = 1;
        play = play;
      },
    );
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the chirp quiet while the call is open and brings it back after hanging up", () => {
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
    playNotificationPing("frog");
    expect(play).not.toHaveBeenCalled();

    act(() => root.unmount());
    playNotificationPing("frog");
    expect(play).toHaveBeenCalledTimes(1);
  });
});
