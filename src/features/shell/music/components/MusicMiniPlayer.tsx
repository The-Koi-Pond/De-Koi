import { Pause, Play, RotateCcw, Search, Square, Volume2, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { musicApi, type MusicCandidate, type MusicStatus } from "../../../../shared/api/music-api";
import { MUSIC_PLAYBACK_EVENT, type MusicPlaybackEventDetail } from "../../../../shared/lib/music-playback-events";
import { useUIStore } from "../../../../shared/stores/ui.store";

function youtubeVideoId(track: MusicCandidate | null): string | null {
  if (!track) return null;
  const raw = `${track.id} ${track.url ?? ""}`;
  const patterns = [/youtube:([a-zA-Z0-9_-]{11})/, /[?&]v=([a-zA-Z0-9_-]{11})/, /youtu\.be\/([a-zA-Z0-9_-]{11})/];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function embedUrl(videoId: string | null, playing: boolean): string | null {
  if (!videoId) return null;
  const autoplay = playing ? "1" : "0";
  return `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay}&loop=1&playlist=${videoId}&enablejsapi=1`;
}

function useMusicStatus(): MusicStatus | null {
  const [status, setStatus] = useState<MusicStatus | null>(null);
  useEffect(() => {
    let alive = true;
    musicApi.status().then((next) => alive && setStatus(next)).catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

function MobileDragShell({ children }: { children: ReactNode }) {
  const collapsed = useUIStore((s) => s.spotifyMobileWidgetCollapsed);
  const position = useUIStore((s) => s.spotifyMobileWidgetPosition);
  const setCollapsed = useUIStore((s) => s.setSpotifyMobileWidgetCollapsed);
  const setPosition = useUIStore((s) => s.setSpotifyMobileWidgetPosition);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-20 right-4 z-50 rounded-full border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--foreground)] shadow-lg"
        aria-label="Open Music DJ"
      >
        <Volume2 className="h-4 w-4" />
      </button>
    );
  }

  const left = Math.max(8, Math.min(position.x ?? 16, typeof window === "undefined" ? 320 : window.innerWidth - 360));
  const bottom = Math.max(8, position.y ?? 96);
  return (
    <div className="fixed z-50 w-[min(22rem,calc(100vw-1.5rem))]" style={{ left, bottom }}>
      <div className="mb-1 flex justify-end gap-1">
        <button type="button" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs" onClick={() => setPosition({ x: left > 80 ? 16 : 160, y: bottom })}>
          Move
        </button>
        <button type="button" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs" onClick={() => setCollapsed(true)}>
          Hide
        </button>
      </div>
      {children}
    </div>
  );
}

export function MusicMiniPlayer({ mobile = false }: { mobile?: boolean }) {
  const status = useMusicStatus();
  const [query, setQuery] = useState("quiet fantasy tavern instrumental ambience");
  const [track, setTrack] = useState<MusicCandidate | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(55);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const videoId = youtubeVideoId(track);
  const src = useMemo(() => embedUrl(videoId, playing), [videoId, playing]);

  async function playTrack(next: MusicCandidate, nextVolume = volume) {
    setTrack(next);
    await musicApi.play({ provider: next.provider, track: next, volume: nextVolume });
    setPlaying(true);
  }

  async function pick(fresh = false, overrideQuery?: string | null) {
    const searchQuery = (overrideQuery ?? query).trim();
    if (!searchQuery) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = fresh
        ? await musicApi.freshPick({ query: searchQuery, limit: 5 })
        : await musicApi.searchCandidates({ query: searchQuery, limit: 5 });
      const next = response.candidates[0] ?? null;
      const providerErrorMessage = response.providerError?.message ?? null;
      setTrack(next);
      if (next) {
        await playTrack(next);
      } else {
        setPlaying(false);
        setMessage(
          providerErrorMessage ?? "No YouTube candidate found. Install yt-dlp for power search, or paste a YouTube URL.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Music search failed");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setPlaying(false);
    await musicApi.stop().catch(() => undefined);
  }

  async function pause() {
    setPlaying(false);
    await musicApi.pause().catch(() => undefined);
  }

  async function updateVolume(next: number) {
    setVolume(next);
    await musicApi.setVolume({ volume: next }).catch(() => undefined);
  }

  useEffect(() => {
    function onMusicEvent(event: Event) {
      const detail = (event as CustomEvent<MusicPlaybackEventDetail>).detail;
      if (!detail) return;
      if (detail.type === "cue") {
        if (typeof detail.volume === "number") setVolume(Math.max(0, Math.min(100, Math.trunc(detail.volume))));
        if (detail.track) {
          void playTrack(detail.track, typeof detail.volume === "number" ? detail.volume : volume);
        } else if (detail.query) {
          setQuery(detail.query);
          void pick(false, detail.query);
        }
      } else if (detail.type === "volume") {
        void updateVolume(detail.volume);
      } else if (detail.type === "pause") {
        void pause();
      } else if (detail.type === "stop") {
        void stop();
      }
    }
    window.addEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
    return () => window.removeEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
  }, [query, volume]);

  const player = (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--foreground)] shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--muted)]">
            <Volume2 className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{track?.title ?? "Music DJ"}</div>
            <div className="truncate text-[var(--muted-foreground)]">{track?.channelOrArtist ?? "YouTube first"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[var(--muted-foreground)]">
          <Zap className="h-3 w-3" />
          {status?.powerModeAvailable ? "Power" : "Iframe"}
        </div>
      </div>

      {src ? <iframe className="mb-2 h-24 w-full rounded border-0" src={src} title="Music DJ YouTube player" allow="autoplay; encrypted-media" /> : null}

      <div className="mb-2 flex gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none"
          placeholder="Mood, genre, or YouTube URL"
        />
        <button type="button" className="rounded border border-[var(--border)] p-1.5" onClick={() => pick(false)} disabled={busy} aria-label="Search music">
          <Search className="h-4 w-4" />
        </button>
        <button type="button" className="rounded border border-[var(--border)] p-1.5" onClick={() => pick(true)} disabled={busy} aria-label="Fresh pick">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-[var(--border)] p-1.5" onClick={() => (playing ? pause() : pick(false))} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" className="rounded border border-[var(--border)] p-1.5" onClick={stop} aria-label="Stop">
          <Square className="h-4 w-4" />
        </button>
        <input className="min-w-24 flex-1" type="range" min={0} max={100} value={volume} onChange={(event) => updateVolume(Number(event.target.value))} aria-label="Music volume" />
        <span className="w-8 text-right text-xs text-[var(--muted-foreground)]">{volume}</span>
      </div>
      {message ? <div className="mt-2 text-xs text-[var(--muted-foreground)]">{message}</div> : null}
    </section>
  );

  return mobile ? <MobileDragShell>{player}</MobileDragShell> : <div className="w-80">{player}</div>;
}

export function MusicMobileWidget() {
  return <MusicMiniPlayer mobile />;
}
