import { GripHorizontal, Pause, Play, RotateCcw, Search, Square, Volume2, X, Zap } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { musicApi, type MusicCandidate, type MusicStatus } from "../../../../shared/api/music-api";
import { musicDjIntentLabel, type MusicDjIntent } from "../../../../shared/lib/music-dj-intent";
import { rankMusicCandidates } from "../../../../shared/lib/music-candidate-ranking";
import { MUSIC_PLAYBACK_EVENT, type MusicPlaybackEventDetail } from "../../../../shared/lib/music-playback-events";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  clampMusicWidgetPosition,
  defaultMusicWidgetPosition,
  type MusicWidgetPosition,
  type MusicWidgetSize,
} from "../lib/music-widget-position";

const DEFAULT_MUSIC_QUERY = "quiet fantasy tavern instrumental ambience";
const DEFAULT_WIDGET_SIZE: MusicWidgetSize = { width: 352, height: 188 };
const LEGACY_DEFAULT_POSITION: MusicWidgetPosition = { x: 16, y: 96 };

function youtubeVideoIdFromText(raw: string): string | null {
  const text = raw.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const patterns = [
    /youtube:([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function youtubeVideoId(track: MusicCandidate | null): string | null {
  if (!track) return null;
  const raw = `${track.id} ${track.url ?? ""}`;
  return youtubeVideoIdFromText(raw);
}

function musicTrackKey(track: MusicCandidate | null): string | null {
  if (!track) return null;
  return youtubeVideoId(track) ?? track.id ?? null;
}

function isDirectYouTubeTarget(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  return youtubeVideoIdFromText(text) !== null && /^(https?:\/\/|www\.|youtube:|[a-zA-Z0-9_-]{11}$)/.test(text);
}

function embedUrl(videoId: string | null, playing: boolean): string | null {
  if (!videoId) return null;
  const autoplay = playing ? "1" : "0";
  return `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay}&loop=1&playlist=${videoId}&enablejsapi=1`;
}

function viewportSize(): MusicWidgetSize {
  if (typeof window === "undefined") return { width: 390, height: 720 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function measuredWidgetSize(element: HTMLDivElement | null): MusicWidgetSize {
  const rect = element?.getBoundingClientRect();
  if (!rect) return DEFAULT_WIDGET_SIZE;
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function isLegacyDefaultPosition(position: MusicWidgetPosition): boolean {
  return position.x === LEGACY_DEFAULT_POSITION.x && position.y === LEGACY_DEFAULT_POSITION.y;
}

function resolvedWidgetPosition(position: MusicWidgetPosition, widget: MusicWidgetSize): MusicWidgetPosition {
  const viewport = viewportSize();
  const base = isLegacyDefaultPosition(position) ? defaultMusicWidgetPosition(viewport, widget) : position;
  return clampMusicWidgetPosition(base, viewport, widget);
}

function useMusicStatus(): MusicStatus | null {
  const [status, setStatus] = useState<MusicStatus | null>(null);
  useEffect(() => {
    let alive = true;
    musicApi
      .status()
      .then((next) => alive && setStatus(next))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

function FloatingMusicShell({ children }: { children: ReactNode }) {
  const collapsed = useUIStore((s) => s.spotifyMobileWidgetCollapsed);
  const position = useUIStore((s) => s.spotifyMobileWidgetPosition);
  const setCollapsed = useUIStore((s) => s.setSpotifyMobileWidgetCollapsed);
  const setPosition = useUIStore((s) => s.setSpotifyMobileWidgetPosition);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPosition: MusicWidgetPosition;
  } | null>(null);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-28 right-4 z-[60] inline-flex h-11 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-3 text-[var(--foreground)] shadow-[0_12px_36px_rgba(0,0,0,0.32)] backdrop-blur-xl transition-transform hover:-translate-y-0.5 hover:border-[var(--primary)]/45 md:h-10 md:rounded-xl"
        aria-label="Open Music DJ"
        title="Open Music DJ"
      >
        <Volume2 className="h-4 w-4" />
        <span className="hidden text-xs font-medium md:inline">Music DJ</span>
      </button>
    );
  }

  const widgetSize = measuredWidgetSize(shellRef.current);
  const currentPosition = resolvedWidgetPosition(position, widgetSize);
  const floatingStyle = {
    "--music-widget-left": `${currentPosition.x}px`,
    "--music-widget-bottom": `${currentPosition.y}px`,
  } as CSSProperties;

  function updateDrag(next: MusicWidgetPosition) {
    setPosition(clampMusicWidgetPosition(next, viewportSize(), measuredWidgetSize(shellRef.current)));
  }

  function onDragStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: currentPosition,
    };
  }

  function onDragMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateDrag({
      x: drag.startPosition.x + event.clientX - drag.startX,
      y: drag.startPosition.y - (event.clientY - drag.startY),
    });
  }

  function onDragEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={shellRef}
      className="fixed left-[var(--music-widget-left)] bottom-[var(--music-widget-bottom)] z-[60] w-[min(22rem,calc(100vw-1.5rem))]"
      style={floatingStyle}
    >
      <div className="mb-1 flex justify-end gap-1">
        <button
          type="button"
          className="inline-flex h-7 w-9 cursor-grab items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)]/90 text-[var(--muted-foreground)] shadow-sm backdrop-blur transition-colors hover:text-[var(--foreground)] active:cursor-grabbing"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          aria-label="Drag Music DJ"
          title="Drag Music DJ"
        >
          <GripHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)]/90 text-[var(--muted-foreground)] shadow-sm backdrop-blur transition-colors hover:text-[var(--foreground)]"
          onClick={() => setCollapsed(true)}
          aria-label="Hide Music DJ"
          title="Hide Music DJ"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

export function MusicMiniPlayer({ mobile = false }: { mobile?: boolean }) {
  const status = useMusicStatus();
  const [query, setQuery] = useState(DEFAULT_MUSIC_QUERY);
  const [lastDiscoveryQuery, setLastDiscoveryQuery] = useState(DEFAULT_MUSIC_QUERY);
  const [track, setTrack] = useState<MusicCandidate | null>(null);
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(55);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const videoId = youtubeVideoId(track);
  const src = useMemo(() => embedUrl(videoId, playing), [videoId, playing]);

  async function playTrack(next: MusicCandidate, nextVolume = volume) {
    setTrack(next);
    const key = musicTrackKey(next);
    if (key) setRecentTrackIds((current) => [key, ...current.filter((entry) => entry !== key)].slice(0, 8));
    await musicApi.play({ provider: next.provider, track: next, volume: nextVolume });
    setPlaying(true);
  }

  async function pick(fresh = false, overrideQuery?: string | null, intent?: MusicDjIntent | null, overrideVolume?: number | null) {
    const requestedQuery = (overrideQuery ?? query).trim();
    const requestedVolume = typeof overrideVolume === "number" ? overrideVolume : volume;
    const usedDiscoveryFallback = fresh && isDirectYouTubeTarget(requestedQuery);
    const searchQuery = usedDiscoveryFallback ? lastDiscoveryQuery.trim() || DEFAULT_MUSIC_QUERY : requestedQuery;
    if (!searchQuery) return;
    if (!isDirectYouTubeTarget(searchQuery)) {
      setLastDiscoveryQuery(searchQuery);
    }
    if (usedDiscoveryFallback) {
      setQuery(searchQuery);
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = fresh
        ? await musicApi.freshPick({ query: searchQuery, limit: 8 })
        : await musicApi.searchCandidates({ query: searchQuery, limit: 8 });
      const currentTrackId = musicTrackKey(track);
      const ranked = rankMusicCandidates(response.candidates, {
        query: searchQuery,
        intent,
        currentTrackId,
        recentTrackIds,
        fresh,
      });
      const next = ranked[0] ?? null;
      setTrack(next);
      if (next) {
        await playTrack(next, requestedVolume);
        if (intent) {
          setMessage(`Music DJ: ${musicDjIntentLabel(intent)}${intent.reason ? ` - ${intent.reason}` : ""}`);
        } else if (usedDiscoveryFallback) {
          setMessage(`Fresh pick uses mood text, so I used: ${searchQuery}`);
        }
      } else {
        setPlaying(false);
        setMessage(
          "No YouTube result found. Search needs yt-dlp on this machine; pasted YouTube URLs can still play directly.",
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
          if (detail.query) setQuery(detail.query);
          void playTrack(detail.track, typeof detail.volume === "number" ? detail.volume : volume);
          if (detail.intent) setMessage(`Music DJ: ${musicDjIntentLabel(detail.intent)}`);
        } else if (detail.query) {
          setQuery(detail.query);
          void pick(detail.fresh === true, detail.query, detail.intent ?? null, detail.volume ?? null);
        }
      } else if (detail.type === "volume") {
        if (detail.intent) setMessage(`Music DJ volume: ${musicDjIntentLabel(detail.intent)}`);
        void updateVolume(detail.volume);
      } else if (detail.type === "pause") {
        void pause();
      } else if (detail.type === "stop") {
        void stop();
      }
    }
    window.addEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
    return () => window.removeEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
  }, [query, volume, track, recentTrackIds]);

  const player = (
    <section className="overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] p-2.5 text-[var(--foreground)] shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
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
        <div className="flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[var(--muted-foreground)]">
          <Zap className="h-3 w-3" />
          {status?.powerModeAvailable ? "Power" : "Iframe"}
        </div>
      </div>

      {src ? (
        <iframe
          className="mb-2 h-24 w-full rounded border-0"
          src={src}
          title="Music DJ YouTube player"
          allow="autoplay; encrypted-media"
        />
      ) : null}

      <div className="mb-2 flex gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none"
          placeholder="Mood, genre, or YouTube URL"
        />
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => pick(false)}
          disabled={busy}
          aria-label="Search music"
          title="Search YouTube music"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => pick(true)}
          disabled={busy}
          aria-label="Fresh pick"
          title="Fresh pick"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => (playing ? pause() : pick(false))}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" className="rounded border border-[var(--border)] p-1.5" onClick={stop} aria-label="Stop">
          <Square className="h-4 w-4" />
        </button>
        <input
          className="min-w-24 flex-1"
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(event) => updateVolume(Number(event.target.value))}
          aria-label="Music volume"
        />
        <span className="w-8 text-right text-xs text-[var(--muted-foreground)]">{volume}</span>
      </div>
      {message ? <div className="mt-2 line-clamp-2 text-xs text-[var(--muted-foreground)]">{message}</div> : null}
    </section>
  );

  return mobile ? <FloatingMusicShell>{player}</FloatingMusicShell> : <div className="w-80">{player}</div>;
}

export function MusicFloatingWidget() {
  return <MusicMiniPlayer mobile />;
}

export function MusicMobileWidget() {
  return <MusicFloatingWidget />;
}