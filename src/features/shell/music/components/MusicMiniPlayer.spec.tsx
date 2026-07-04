import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchMusicPlaybackEvent } from "../../../../shared/lib/music-playback-events";
import { MusicMiniPlayer } from "./MusicMiniPlayer";

const { musicApiMock, sendYouTubeIframeCommandMock } = vi.hoisted(() => ({
  musicApiMock: {
    searchCandidates: vi.fn(),
    freshPick: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
  },
  sendYouTubeIframeCommandMock: vi.fn(),
}));

vi.mock("../../../../shared/api/music-api", () => ({
  musicApi: musicApiMock,
}));

vi.mock("../lib/youtube-iframe-player", () => ({
  sendYouTubeIframeCommand: sendYouTubeIframeCommandMock,
}));

const candidate = {
  provider: "youtube" as const,
  id: "youtube:abc123def45",
  title: "Disciple",
  channelOrArtist: "Throbbing Gristle",
  url: "https://www.youtube.com/watch?v=abc123def45",
};

async function flushAsyncWork() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("MusicMiniPlayer", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    musicApiMock.searchCandidates.mockResolvedValue({
      provider: "youtube",
      candidates: [candidate],
      requiresSetup: false,
      powerModeAvailable: false,
      iframeFallbackAvailable: true,
    });
    musicApiMock.freshPick.mockResolvedValue({
      provider: "youtube",
      candidates: [candidate],
      requiresSetup: false,
      powerModeAvailable: false,
      iframeFallbackAvailable: true,
    });
    musicApiMock.play.mockResolvedValue({ provider: "youtube", state: "playing", track: candidate, volume: 55 });
    musicApiMock.pause.mockResolvedValue({ provider: "youtube", state: "paused" });
    musicApiMock.stop.mockResolvedValue({ provider: "youtube", state: "stopped" });
    musicApiMock.setVolume.mockResolvedValue({ provider: "youtube", state: "volume" });
    sendYouTubeIframeCommandMock.mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("min-width"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
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
    container?.remove();
    container = null;
    Object.values(musicApiMock).forEach((mock) => mock.mockReset());
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("plays the latest cue that was sent before the mini player mounted", async () => {
    dispatchMusicPlaybackEvent({ type: "cue", query: "Disciple Throbbing Gristle" });

    await act(async () => {
      root = createRoot(container!);
      root.render(<MusicMiniPlayer variant="toolbar" />);
    });
    await flushAsyncWork();

    expect(musicApiMock.searchCandidates).toHaveBeenCalledWith({
      query: "Disciple Throbbing Gristle",
      limit: 8,
    });
    expect(musicApiMock.play).toHaveBeenCalledWith({ provider: "youtube", track: candidate, volume: 55 });
  });
});
