import { Loader2, Music2, Pause, Play, SkipForward, ThumbsDown, ThumbsUp, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MusicDjTrack } from "../../../../engine/contracts/types/music-dj";
import { musicDjApi } from "../../../../shared/api/music-dj-api";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";

type MusicDjPlayerProps = {
  visible?: boolean;
  nowPlaying?: MusicDjTrack | null;
  mobile?: boolean;
};

type YouTubePlayerStateEvent = { data: number };
type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  destroy: () => void;
  setVolume: (volume: number) => void;
  loadVideoById: (videoId: string) => void;
};

type YouTubePlayerConstructor = new (
  elementId: string,
  options: {
    videoId: string;
    width: string;
    height: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady: () => void;
      onStateChange: (event: YouTubePlayerStateEvent) => void;
      onError: () => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const DEFAULT_TRACK: MusicDjTrack | null = null;
const YOUTUBE_PLAYING = 1;
const YOUTUBE_PAUSED = 2;
const YOUTUBE_ENDED = 0;

let youtubeIframeApiPromise: Promise<void> | null = null;

function isMusicDjTrack(value: unknown): value is MusicDjTrack {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.provider === "youtube" &&
    typeof record.videoId === "string" &&
    /^[A-Za-z0-9_-]{6,}$/.test(record.videoId) &&
    typeof record.title === "string" &&
    typeof record.channel === "string"
  );
}

function useActiveMusicDjState() {
  const metadata = useChatStore((state) => state.activeChat?.metadata ?? null);
  return useMemo(() => {
    const nowPlaying = isMusicDjTrack(metadata?.musicDjNowPlaying) ? metadata.musicDjNowPlaying : null;
    const volume = typeof metadata?.musicDjVolume === "number" ? Math.max(0, Math.min(100, metadata.musicDjVolume)) : 50;
    return { nowPlaying, volume };
  }, [metadata]);
}

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-de-koi-youtube-iframe-api="true"]');
    if (existing) return;

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.deKoiYoutubeIframeApi = "true";
    script.onerror = () => reject(new Error("YouTube IFrame API failed to load."));
    document.body.appendChild(script);
  });

  return youtubeIframeApiPromise;
}

function youtubePlayerVars(paused: boolean): Record<string, string | number> {
  return {
    autoplay: paused ? 0 : 1,
    controls: 1,
    enablejsapi: 1,
    playsinline: 1,
    rel: 0,
    modestbranding: 1,
    origin: typeof window === "undefined" ? "https://de-koi.local" : window.location.origin,
  };
}

export function MusicDjPlayer({ visible = true, nowPlaying = DEFAULT_TRACK, mobile = false }: MusicDjPlayerProps) {
  const activeMusicDjState = useActiveMusicDjState();
  const playerElementId = useId().replace(/:/g, "-");
  const playerRef = useRef<YouTubePlayer | null>(null);
  const activeVideoIdRef = useRef<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [volume, setVolume] = useState(activeMusicDjState.volume);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState<"like" | "skip" | null>(null);
  const track = nowPlaying ?? activeMusicDjState.nowPlaying;

  useEffect(() => {
    setVolume(activeMusicDjState.volume);
    playerRef.current?.setVolume(activeMusicDjState.volume);
  }, [activeMusicDjState.volume]);

  useEffect(() => {
    if (!visible || !track || mobileCollapsed) {
      playerRef.current?.pauseVideo();
    }
  }, [mobileCollapsed, track, visible]);

  useEffect(() => {
    if (!visible || !track || mobileCollapsed) return;
    let disposed = false;

    setPlayerError(null);
    void loadYouTubeIframeApi()
      .then(() => {
        if (disposed || !window.YT?.Player) return;
        if (playerRef.current) {
          if (activeVideoIdRef.current !== track.videoId) {
            playerRef.current.loadVideoById(track.videoId);
            activeVideoIdRef.current = track.videoId;
            setPaused(false);
          }
          playerRef.current.setVolume(volume);
          return;
        }

        playerRef.current = new window.YT.Player(playerElementId, {
          videoId: track.videoId,
          width: "100%",
          height: "100%",
          playerVars: youtubePlayerVars(paused),
          events: {
            onReady: () => {
              if (disposed) return;
              activeVideoIdRef.current = track.videoId;
              playerRef.current?.setVolume(volume);
              setPlayerReady(true);
              if (!paused) playerRef.current?.playVideo();
            },
            onStateChange: (event) => {
              const playing = window.YT?.PlayerState?.PLAYING ?? YOUTUBE_PLAYING;
              const pausedState = window.YT?.PlayerState?.PAUSED ?? YOUTUBE_PAUSED;
              const ended = window.YT?.PlayerState?.ENDED ?? YOUTUBE_ENDED;
              if (event.data === playing) setPaused(false);
              if (event.data === pausedState || event.data === ended) setPaused(true);
            },
            onError: () => setPlayerError("YouTube could not play this video."),
          },
        });
      })
      .catch((error) => setPlayerError(error instanceof Error ? error.message : "YouTube player failed."));

    return () => {
      disposed = true;
    };
  }, [mobileCollapsed, paused, playerElementId, track, visible, volume]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      activeVideoIdRef.current = null;
    };
  }, []);

  const sendFeedback = useCallback(
    async (action: "like" | "skip" | "dislike") => {
      if (!track) return;
      setFeedbackPending(action === "like" ? "like" : "skip");
      try {
        if (action === "skip") playerRef.current?.pauseVideo();
        await musicDjApi.feedback({ provider: "youtube", action, track });
      } finally {
        setFeedbackPending(null);
      }
    },
    [track],
  );

  const togglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (paused) {
      player.playVideo();
      setPaused(false);
      return;
    }
    player.pauseVideo();
    setPaused(true);
  }, [paused]);

  const changeVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVolume)));
    setVolume(clamped);
    playerRef.current?.setVolume(clamped);
  }, []);

  const collapseMobile = useCallback(() => {
    playerRef.current?.pauseVideo();
    setPaused(true);
    setMobileCollapsed(true);
  }, []);

  if (!visible) return null;

  if (!track) {
    return (
      <div className="relative hidden h-10 min-w-0 max-w-[31rem] flex-1 items-center gap-2 overflow-hidden rounded-full border border-[oklch(0.42_0.03_42)] bg-[oklch(0.17_0.012_42)] px-3 text-[oklch(0.88_0.018_80)] md:flex">
        <Music2 size="0.875rem" className="text-[oklch(0.78_0.15_28)]" />
        <span className="truncate text-xs font-semibold">Assistant DJ ready</span>
        <span className="truncate text-[0.68rem] text-[oklch(0.68_0.018_80)]">YouTube music will appear here when a scene starts.</span>
      </div>
    );
  }

  if (mobile && mobileCollapsed) {
    return (
      <button
        type="button"
        className="fixed bottom-3 right-3 z-[60] inline-flex h-12 w-12 items-center justify-center rounded-full border border-[oklch(0.42_0.03_42)] bg-[oklch(0.16_0.012_42)] text-[oklch(0.78_0.15_28)] shadow-lg md:hidden"
        onClick={() => setMobileCollapsed(false)}
        aria-label="Expand Music DJ player"
        title="Expand Music DJ player"
      >
        <Music2 size="1.125rem" />
      </button>
    );
  }

  return (
    <section
      className={cn(
        "overflow-hidden border border-[oklch(0.42_0.03_42)] bg-[oklch(0.16_0.012_42)] text-[oklch(0.95_0.012_80)] shadow-lg shadow-black/25",
        mobile
          ? "fixed bottom-3 left-3 right-3 z-[60] rounded-lg md:hidden"
          : "relative hidden h-24 min-w-[24rem] max-w-[34rem] flex-1 rounded-lg md:flex",
      )}
    >
      <div className="aspect-video h-full shrink-0 bg-black" data-testid="music-dj-youtube-frame">
        <div id={playerElementId} className="h-full w-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black uppercase tracking-normal text-[oklch(0.78_0.15_28)]">Assistant DJ</p>
            <p className="truncate text-sm font-semibold leading-tight">{track.title}</p>
            <p className="truncate text-[0.68rem] text-[oklch(0.72_0.018_80)]">{playerError ?? track.channel}</p>
          </div>
          {mobile && (
            <button
              type="button"
              aria-label="Collapse Music DJ player"
              title="Collapse Music DJ player"
              onClick={collapseMobile}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[oklch(0.78_0.025_80)] hover:text-[oklch(0.96_0.012_80)]"
            >
              <X size="0.8125rem" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={paused ? "Resume music" : "Pause music"}
            title={paused ? "Resume music" : "Pause music"}
            onClick={togglePlayback}
            disabled={!playerReady}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.92_0.012_80)] text-[oklch(0.15_0.012_42)] transition-transform hover:scale-105 disabled:cursor-wait disabled:opacity-70"
          >
            {!playerReady ? <Loader2 size="0.8125rem" className="animate-spin" /> : paused ? <Play size="0.8125rem" /> : <Pause size="0.8125rem" />}
          </button>
          <button
            type="button"
            aria-label="Skip track"
            title="Skip track"
            onClick={() => void sendFeedback("skip")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.78_0.025_80)] hover:text-[oklch(0.96_0.012_80)]"
          >
            {feedbackPending === "skip" ? <Loader2 size="0.8125rem" className="animate-spin" /> : <SkipForward size="0.8125rem" />}
          </button>
          <button
            type="button"
            aria-label="Like track"
            title="Like track"
            onClick={() => void sendFeedback("like")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.78_0.025_80)] hover:text-[oklch(0.96_0.012_80)]"
          >
            {feedbackPending === "like" ? <Loader2 size="0.8125rem" className="animate-spin" /> : <ThumbsUp size="0.8125rem" />}
          </button>
          <button
            type="button"
            aria-label="Dislike track"
            title="Dislike track"
            onClick={() => void sendFeedback("dislike")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[oklch(0.78_0.025_80)] hover:text-[oklch(0.96_0.012_80)]"
          >
            <ThumbsDown size="0.8125rem" />
          </button>
          <label className="ml-auto flex min-w-20 items-center gap-1 text-[0.65rem] text-[oklch(0.72_0.018_80)]">
            <Volume2 size="0.75rem" />
            <input
              aria-label="Music volume"
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              className="w-20 accent-[oklch(0.78_0.15_28)]"
            />
          </label>
        </div>
      </div>
    </section>
  );
}

export function MusicDjMiniPlayer() {
  return <MusicDjPlayer />;
}

export function MusicDjMobileWidget() {
  return <MusicDjPlayer mobile />;
}