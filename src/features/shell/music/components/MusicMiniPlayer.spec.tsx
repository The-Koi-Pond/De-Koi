import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { dispatchMusicPlaybackEvent, MUSIC_AI_PICK_REQUEST_EVENT } from "../../../../shared/lib/music-playback-events";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { MusicMiniPlayer } from "./MusicMiniPlayer";

const { musicApiMock, spotifyApiMock, updateChatMetadataMock, sendYouTubeIframeCommandMock } = vi.hoisted(() => ({
  musicApiMock: {
    settings: vi.fn(),
    searchCandidates: vi.fn(),
    freshPick: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
  },
  spotifyApiMock: {
    candidates: vi.fn(),
    freshPick: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    playbackState: vi.fn(),
  },
  updateChatMetadataMock: vi.fn(),
  sendYouTubeIframeCommandMock: vi.fn(),
}));

vi.mock("../../../../shared/api/music-api", () => ({
  musicApi: musicApiMock,
  spotifyMusicApi: spotifyApiMock,
}));

vi.mock("../../../catalog/chats/index", () => ({
  useUpdateChatMetadata: () => ({ mutate: updateChatMetadataMock }),
}));

vi.mock("../lib/youtube-iframe-player", () => ({
  sendYouTubeIframeCommand: sendYouTubeIframeCommandMock,
}));

let queryClient: QueryClient;

function withQueryClient(node: ReactNode) {
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

function openChat(metadata: Record<string, unknown>) {
  useChatStore.setState({ activeChatId: "chat-1", activeChat: { id: "chat-1", metadata } as unknown as Chat });
}

function youtubeSettings(source: "youtube" | "spotify" = "youtube") {
  return {
    source,
    spotifyClientId: "",
    spotifyPreferredDeviceId: null,
    spotifyPreferredDeviceName: null,
    spotifyRedirectUri: "http://127.0.0.1:8754/spotify/callback",
  };
}

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
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    musicApiMock.settings.mockResolvedValue(youtubeSettings());
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
    Object.values(spotifyApiMock).forEach((mock) => mock.mockReset());
    updateChatMetadataMock.mockReset();
    useChatStore.setState({ activeChatId: null, activeChat: null });
    queryClient.clear();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("keeps the open chat's YouTube history and avoids it on a fresh pick", async () => {
    const other = { ...candidate, id: "youtube:zzz999yyy88", title: "Other", url: "https://youtu.be/zzz999yyy88" };
    musicApiMock.freshPick.mockResolvedValue({ provider: "youtube", candidates: [candidate, other] });
    openChat({ musicRecentTracks: [{ provider: "youtube", id: "abc123def45" }] });
    dispatchMusicPlaybackEvent({ type: "cue", query: "rain at night", fresh: true });

    await act(async () => {
      root = createRoot(container!);
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
    });
    await flushAsyncWork();

    expect(musicApiMock.play).toHaveBeenCalledWith({ provider: "youtube", track: other, volume: 55 });
    expect(updateChatMetadataMock).toHaveBeenCalledWith({
      id: "chat-1",
      musicRecentTracks: [
        { provider: "youtube", id: "zzz999yyy88" },
        { provider: "youtube", id: "abc123def45" },
      ],
    });
  });

  it("asks Spotify for the chat's source, plays the top pick on the device and records it", async () => {
    const track = {
      provider: "spotify" as const,
      id: "spotify:track:abc",
      title: "Merry-Go-Round",
      channelOrArtist: "Joe Hisaishi",
      thumbnail: "https://i.scdn.co/image/cover",
    };
    musicApiMock.settings.mockResolvedValue(youtubeSettings("spotify"));
    spotifyApiMock.playbackState.mockResolvedValue({
      provider: "spotify",
      state: "stopped",
      track: null,
      device: null,
    });
    spotifyApiMock.candidates.mockResolvedValue({ provider: "spotify", candidates: [track], providerError: null });
    spotifyApiMock.play.mockResolvedValue({
      provider: "spotify",
      state: "accepted",
      confirmed: false,
      device: { id: "dev-1", name: "Desk", type: "Computer", isActive: true, supportsVolume: true, volumePercent: 55 },
      track,
      volume: 55,
      message: "Spotify accepted the track; waiting for Desk.",
    });
    openChat({
      spotifySourceType: "artist",
      spotifyArtist: "Joe Hisaishi",
      spotifyRecentTracks: ["spotify:track:old"],
    });
    dispatchMusicPlaybackEvent({ type: "cue", query: "gentle waltz" });

    await act(async () => {
      root = createRoot(container!);
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
    });
    await flushAsyncWork();

    expect(spotifyApiMock.candidates).toHaveBeenCalledWith({
      source: { type: "artist", artist: "Joe Hisaishi" },
      query: "gentle waltz",
      mood: null,
      setting: null,
      constraints: null,
      recentIds: [{ provider: "spotify", id: "spotify:track:old" }],
      currentTrackId: null,
      fresh: false,
    });
    expect(spotifyApiMock.play).toHaveBeenCalledWith({ track, volume: 55 });
    expect(musicApiMock.play).not.toHaveBeenCalled();
    expect(updateChatMetadataMock).toHaveBeenCalledWith({
      id: "chat-1",
      musicRecentTracks: [
        { provider: "spotify", id: "spotify:track:abc" },
        { provider: "spotify", id: "spotify:track:old" },
      ],
    });
    expect(container!.querySelector("iframe")).toBeNull();
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("https://i.scdn.co/image/cover");
    expect(container!.textContent).toContain("Merry-Go-Round");
    expect(container!.textContent).toContain("Spotify accepted the track; waiting for Desk.");
  });

  it("shows Spotify's message when a pick fails, without playing anything", async () => {
    musicApiMock.settings.mockResolvedValue(youtubeSettings("spotify"));
    spotifyApiMock.playbackState.mockResolvedValue({
      provider: "spotify",
      state: "stopped",
      track: null,
      device: null,
    });
    spotifyApiMock.candidates.mockRejectedValue(
      Object.assign(new Error("Spotify isn't connected. Open Music Player settings to connect it."), {
        details: { code: "music_spotify_not_connected" },
      }),
    );
    dispatchMusicPlaybackEvent({ type: "cue", query: "battle drums" });

    await act(async () => {
      root = createRoot(container!);
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
    });
    await flushAsyncWork();

    expect(spotifyApiMock.play).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Spotify isn't connected. Open Music Player settings to connect it.");
  });

  it("plays the latest cue that was sent before the mini player mounted", async () => {
    dispatchMusicPlaybackEvent({ type: "cue", query: "Disciple Throbbing Gristle" });

    await act(async () => {
      root = createRoot(container!);
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
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
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
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
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
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
    const events: CustomEvent<{ volume?: number }>[] = [];
    function onAiPick(event: Event) {
      events.push(event as CustomEvent<{ volume?: number }>);
      event.preventDefault();
    }
    window.addEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);

    try {
      await act(async () => {
        root = createRoot(container!);
        root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
      });

      const volume = container!.querySelector<HTMLInputElement>('input[aria-label="Music Player volume"]');
      expect(volume).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(volume, "23");
        volume!.dispatchEvent(new Event("input", { bubbles: true }));
        volume!.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
      expect(freshPick).not.toBeNull();
      await act(async () => {
        freshPick!.click();
      });
      await flushAsyncWork();

      expect(events).toHaveLength(1);
      expect(events[0]?.detail.volume).toBe(23);
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
        root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
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

  it("ignores an old AI pick completion after a newer context arrives", async () => {
    let complete: ((result: { status: "completed" | "failed"; message?: string }) => void) | undefined;
    function onAiPick(event: Event) {
      event.preventDefault();
      complete = (
        event as CustomEvent<{
          complete?: (result: { status: "completed" | "failed"; message?: string }) => void;
        }>
      ).detail.complete;
    }
    window.addEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);

    try {
      await act(async () => {
        root = createRoot(container!);
        root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
      });

      const freshPick = container!.querySelector<HTMLButtonElement>('button[aria-label="Fresh Music Player pick"]');
      expect(freshPick).not.toBeNull();
      await act(async () => {
        freshPick!.click();
      });
      expect(container!.textContent).toContain("Music Player is choosing from this scene...");

      await act(async () => {
        dispatchMusicPlaybackEvent({ type: "context", query: "newer quiet library scene" });
      });
      expect(container!.textContent).not.toContain("Music Player is choosing from this scene...");

      await act(async () => {
        complete?.({ status: "failed", message: "old request failed" });
      });
      expect(container!.textContent).not.toContain("old request failed");
      expect(container!.textContent).not.toContain("Music Player is choosing from this scene...");
    } finally {
      window.removeEventListener(MUSIC_AI_PICK_REQUEST_EVENT, onAiPick);
    }
  });

  it("clears stale context instead of falling back to old fantasy music", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(withQueryClient(<MusicMiniPlayer variant="toolbar" />));
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
