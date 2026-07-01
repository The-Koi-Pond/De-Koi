import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MusicDjPlayer } from "./MusicDjPlayer";

vi.mock("../../../../shared/api/music-dj-api", () => ({
  musicDjApi: {
    status: vi.fn(async () => ({ available: true, provider: "youtube" })),
    feedback: vi.fn(async () => ({ success: true })),
  },
}));

type MockPlayer = {
  playVideo: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  stopVideo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  loadVideoById: ReturnType<typeof vi.fn>;
};

let lastPlayer: MockPlayer | null = null;

function installYouTubeMock() {
  lastPlayer = null;
  window.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
    Player: class {
      playVideo = vi.fn();
      pauseVideo = vi.fn();
      stopVideo = vi.fn();
      destroy = vi.fn();
      setVolume = vi.fn();
      loadVideoById = vi.fn();

      constructor(elementId: string, options: { videoId: string; events: { onReady: () => void } }) {
        lastPlayer = {
          playVideo: this.playVideo,
          pauseVideo: this.pauseVideo,
          stopVideo: this.stopVideo,
          destroy: this.destroy,
          setVolume: this.setVolume,
          loadVideoById: this.loadVideoById,
        };
        const host = document.getElementById(elementId);
        const iframe = document.createElement("iframe");
        iframe.title = "YouTube Music DJ player";
        iframe.src = `https://www.youtube.com/embed/${options.videoId}`;
        host?.appendChild(iframe);
        window.setTimeout(options.events.onReady, 0);
      }
    },
  };
}

describe("MusicDjPlayer", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    installYouTubeMock();
  });

  it("renders a visible YouTube player and controls playback through the IFrame API", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MusicDjPlayer
          visible
          nowPlaying={{
            provider: "youtube",
            videoId: "def456",
            title: "Rain Over the Manor",
            channel: "Ambient Archive",
            durationSeconds: 3600,
            thumbnailUrl: "https://img.youtube.com/vi/def456/hqdefault.jpg",
            score: 92,
            reason: "dark ambient manor rain",
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const iframe = host.querySelector<HTMLIFrameElement>('iframe[title="YouTube Music DJ player"]');
    expect(iframe?.src).toContain("https://www.youtube.com/embed/def456");
    expect(lastPlayer?.playVideo).toHaveBeenCalled();

    const pauseButton = host.querySelector<HTMLButtonElement>('button[aria-label="Pause music"]');
    expect(pauseButton).not.toBeNull();
    await act(async () => {
      pauseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lastPlayer?.pauseVideo).toHaveBeenCalled();

    const volume = host.querySelector<HTMLInputElement>('input[aria-label="Music volume"]');
    expect(volume).not.toBeNull();
    await act(async () => {
      if (volume) {
        const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setValue?.call(volume, "27");
        volume.dispatchEvent(new Event("input", { bubbles: true }));
        volume.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(lastPlayer?.setVolume).toHaveBeenCalledWith(27);

    root.unmount();
    host.remove();
  });
});