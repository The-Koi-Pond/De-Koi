import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchMusicPlaybackEvent, MUSIC_AI_PICK_REQUEST_EVENT } from "../../../../shared/lib/music-playback-events";
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

  it("explains the music choice on hover", async () => {
    dispatchMusicPlaybackEvent({
      type: "cue",
      query: "ominous industrial ritual",
      intent: { mood: "ominous", setting: "industrial ritual", reason: "The scene is tense and mechanical." },
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(<MusicMiniPlayer variant="toolbar" />);
    });
    await flushAsyncWork();

    const player = container!.querySelector<HTMLElement>('[data-component="MusicToolbarPlayer"]');
    expect(player).not.toBeNull();
    expect(player!.getAttribute("title")).toBe(
      'Picked "Disciple" for ominous - industrial ritual. Cue: "ominous industrial ritual". Reason: The scene is tense and mechanical.',
    );
  });

  it("does not search or play when Fresh Pick has no current cue", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<MusicMiniPlayer variant="toolbar" />);
    });

    const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
    expect(freshPick).not.toBeNull();
    await act(async () => {
      freshPick!.click();
    });
    await flushAsyncWork();

    expect(musicApiMock.freshPick).not.toHaveBeenCalled();
    expect(musicApiMock.searchCandidates).not.toHaveBeenCalled();
    expect(musicApiMock.play).not.toHaveBeenCalled();
    expect(container!.textContent).toContain(
      "Music Player needs a current mood, scene cue, or YouTube URL before it can pick music.",
    );
    const player = container!.querySelector<HTMLElement>('[data-component="MusicToolbarPlayer"]');
    expect(player?.getAttribute("title")).toBe(
      "Nothing played: Music Player needs a current mood, scene cue, or YouTube URL before it can pick music.",
    );
  });

  it("requests an AI scene pick before using the direct Fresh Pick fallback", async () => {
    const events: Event[] = [];
    function onAiPick(event: Event) {
      events.push(event);
      event.preventDefault();
    }
    window.addEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);

    try {
      await act(async () => {
        root = createRoot(container!);
        root.render(<MusicMiniPlayer variant="toolbar" />);
      });

      const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
      expect(freshPick).not.toBeNull();
      await act(async () => {
        freshPick!.click();
      });
      await flushAsyncWork();

      expect(events).toHaveLength(1);
      expect(musicApiMock.freshPick).not.toHaveBeenCalled();
      expect(musicApiMock.searchCandidates).not.toHaveBeenCalled();
      expect(musicApiMock.play).not.toHaveBeenCalled();
      expect(container!.textContent).toContain("Music Player is choosing from this scene...");
    } finally {
      window.removeEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);
    }
  });

  it("stops saying the AI is choosing when the request finishes without a playable cue", async () => {
    function onAiPick(event: Event) {
      event.preventDefault();
      const detail = (
        event as CustomEvent<{
          complete?: (result: { status: "completed" | "failed"; message?: string }) => void;
        }>
      ).detail;
      detail.complete?.({ status: "completed" });
    }
    window.addEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);

    try {
      await act(async () => {
        root = createRoot(container!);
        root.render(<MusicMiniPlayer variant="toolbar" />);
      });

      const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
      expect(freshPick).not.toBeNull();
      await act(async () => {
        freshPick!.click();
      });
      await flushAsyncWork();

      expect(container!.textContent).not.toContain("Music Player is choosing from this scene...");
      expect(container!.textContent).toContain("Music Player finished without choosing a track.");
    } finally {
      window.removeEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);
    }
  });

  it("clears stale context instead of falling back to old fantasy music", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<MusicMiniPlayer variant="toolbar" />);
    });

    await act(async () => {
      dispatchMusicPlaybackEvent({ type: "context", query: "quiet fantasy tavern instrumental ambience" });
    });
    await act(async () => {
      dispatchMusicPlaybackEvent({ type: "context", query: null });
    });

    const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
    expect(freshPick).not.toBeNull();
    await act(async () => {
      freshPick!.click();
    });
    await flushAsyncWork();

    expect(musicApiMock.freshPick).not.toHaveBeenCalled();
    expect(musicApiMock.searchCandidates).not.toHaveBeenCalled();
    expect(musicApiMock.play).not.toHaveBeenCalled();
    expect(container!.textContent).toContain(
      "Music Player needs a current mood, scene cue, or YouTube URL before it can pick music.",
    );
    const player = container!.querySelector<HTMLElement>('[data-component="MusicToolbarPlayer"]');
    expect(player?.getAttribute("title")).toBe(
      "Nothing played: Music Player needs a current mood, scene cue, or YouTube URL before it can pick music.",
    );
  });
});
