import { GripHorizontal, Music2, Pause, Play, RotateCcw, Search, Square, Volume2, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { musicApi, type MusicCandidate } from "../../../../shared/api/music-api";
import { musicDjIntentLabel, type MusicDjIntent } from "../../../../shared/lib/music-dj-intent";
import { rankMusicCandidates } from "../../../../shared/lib/music-candidate-ranking";
import {
  consumePendingMusicPlaybackCue,
  getLastMusicPlaybackContext,
  MUSIC_AI_PICK_CHOOSING_MESSAGE,
  MUSIC_AI_PICK_FAILED_MESSAGE,
  MUSIC_AI_PICK_NO_TRACK_MESSAGE,
  MUSIC_PLAYBACK_EVENT,
  requestMusicAiPick,
  type MusicPlaybackEventDetail,
} from "../../../../shared/lib/music-playback-events";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  clampMusicWidgetPosition,
  defaultMusicWidgetPosition,
  type MusicWidgetPosition,
  type MusicWidgetSize,
} from "../lib/music-widget-position";
import { getMusicPlayerDisplay } from "../lib/music-player-display";
import { sendYouTubeIframeCommand } from "../lib/youtube-iframe-player";

const DEFAULT_WIDGET_SIZE: MusicWidgetSize = { width: 352, height: 188 };
const LEGACY_DEFAULT_POSITION: MusicWidgetPosition = { x: 16, y: 96 };
const NO_MUSIC_CUE_MESSAGE = "Music Player needs a current mood, scene cue, or YouTube URL before it can pick music.";
const NO_MUSIC_CUE_EXPLANATION = `Nothing played: ${NO_MUSIC_CUE_MESSAGE}`;

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

function musicChoiceExplanation({
  track,
  searchQuery,
  intent,
  fresh,
  usedDiscoveryFallback,
}: {
  track: MusicCandidate;
  searchQuery: string;
  intent?: MusicDjIntent | null;
  fresh: boolean;
  usedDiscoveryFallback: boolean;
}): string {
  const title = track.title.trim() || "selected track";
  const label = intent ? musicDjIntentLabel(intent) : fresh ? "a fresh pick" : "the current cue";
  const parts = [`Picked "${title}" for ${label}.`];
  if (searchQuery.trim()) parts.push(`Cue: "${searchQuery.trim()}".`);
  const reason = intent?.reason?.trim();
  if (reason) {
    parts.push(`Reason: ${reason}`);
  } else if (usedDiscoveryFallback) {
    parts.push("Reason: Fresh Pick reused the last mood text instead of the current YouTube URL.");
  } else if (fresh) {
    parts.push("Reason: Fresh Pick avoided the current and recent tracks when possible.");
  } else {
    parts.push("Reason: This was the top ranked YouTube result for the cue.");
  }
  return parts.join(" ");
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
        aria-label="Open Music Player"
        title="Open Music Player"
      >
        <Volume2 className="h-4 w-4" />
        <span className="hidden text-xs font-medium md:inline">Music Player</span>
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
          aria-label="Drag Music Player"
          title="Drag Music Player"
        >
          <GripHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)]/90 text-[var(--muted-foreground)] shadow-sm backdrop-blur transition-colors hover:text-[var(--foreground)]"
          onClick={() => setCollapsed(true)}
          aria-label="Hide Music Player"
          title="Hide Music Player"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

type MusicMiniPlayerVariant = "floating" | "toolbar";

function musicPlayerMediaQuery(variant: MusicMiniPlayerVariant): string {
  return variant === "toolbar" ? "(min-width: 768px)" : "(max-width: 767px)";
}

function useMusicPlayerVisible(variant: MusicMiniPlayerVariant): boolean {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return variant === "toolbar";
    return window.matchMedia(musicPlayerMediaQuery(variant)).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(musicPlayerMediaQuery(variant));
    const update = () => setVisible(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [variant]);

  return visible;
}

export function MusicMiniPlayer({ mobile = false, variant }: { mobile?: boolean; variant?: MusicMiniPlayerVariant }) {
  const resolvedVariant = variant ?? (mobile ? "floating" : "toolbar");
  const visible = useMusicPlayerVisible(resolvedVariant);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const aiPickRequestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [lastDiscoveryQuery, setLastDiscoveryQuery] = useState("");
  const [track, setTrack] = useState<MusicCandidate | null>(null);
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(55);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choiceExplanation, setChoiceExplanation] = useState("No music has been picked yet.");

  const videoId = youtubeVideoId(track);
  const src = useMemo(() => embedUrl(videoId, playing), [videoId, playing]);
  const display = getMusicPlayerDisplay(track);
  const displaySubtitle = message ?? display.subtitle;

  async function playTrack(next: MusicCandidate, nextVolume = volume, nextChoiceExplanation?: string) {
    setTrack(next);
    if (nextChoiceExplanation) setChoiceExplanation(nextChoiceExplanation);
    const key = musicTrackKey(next);
    if (key) setRecentTrackIds((current) => [key, ...current.filter((entry) => entry !== key)].slice(0, 8));
    await musicApi.play({ provider: next.provider, track: next, volume: nextVolume });
    setPlaying(true);
    sendYouTubeIframeCommand(iframeRef.current, "playVideo");
  }

  async function pick(
    fresh = false,
    overrideQuery?: string | null,
    intent?: MusicDjIntent | null,
    overrideVolume?: number | null,
  ) {
    const requestedQuery = (overrideQuery ?? query).trim();
    const requestedVolume = typeof overrideVolume === "number" ? overrideVolume : volume;
    const usedDiscoveryFallback = fresh && isDirectYouTubeTarget(requestedQuery);
    const searchQuery = usedDiscoveryFallback ? lastDiscoveryQuery.trim() : requestedQuery;
    if (!searchQuery) {
      setMessage(NO_MUSIC_CUE_MESSAGE);
      setChoiceExplanation(NO_MUSIC_CUE_EXPLANATION);
      return;
    }
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
        const explanation = musicChoiceExplanation({
          track: next,
          searchQuery,
          intent,
          fresh,
          usedDiscoveryFallback,
        });
        await playTrack(next, requestedVolume, explanation);
        if (intent) {
          setMessage(`Music Player: ${musicDjIntentLabel(intent)}${intent.reason ? ` - ${intent.reason}` : ""}`);
        } else if (usedDiscoveryFallback) {
          setMessage(`Fresh pick uses mood text, so I used: ${searchQuery}`);
        }
      } else {
        setPlaying(false);
        setChoiceExplanation(`Nothing played: no YouTube result was found for "${searchQuery}".`);
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

  async function freshPick() {
    const requestId = ++aiPickRequestIdRef.current;
    setMessage(MUSIC_AI_PICK_CHOOSING_MESSAGE);
    if (
      requestMusicAiPick({
        fresh: true,
        volume,
        complete(result) {
          if (aiPickRequestIdRef.current !== requestId) return;
          setMessage((current) => {
            if (current !== MUSIC_AI_PICK_CHOOSING_MESSAGE) return current;
            if (result.status === "failed") return result.message?.trim() || MUSIC_AI_PICK_FAILED_MESSAGE;
            return MUSIC_AI_PICK_NO_TRACK_MESSAGE;
          });
        },
      })
    ) {
      return;
    }
    await pick(true);
  }

  async function resumeOrPick() {
    if (track) {
      await playTrack(track);
      return;
    }
    await pick(false);
  }

  async function stop() {
    setPlaying(false);
    sendYouTubeIframeCommand(iframeRef.current, "stopVideo");
    await musicApi.stop().catch(() => undefined);
  }

  async function pause() {
    setPlaying(false);
    sendYouTubeIframeCommand(iframeRef.current, "pauseVideo");
    await musicApi.pause().catch(() => undefined);
  }

  async function updateVolume(next: number) {
    setVolume(next);
    sendYouTubeIframeCommand(iframeRef.current, "setVolume", [next]);
    await musicApi.setVolume({ volume: next }).catch(() => undefined);
  }

  useEffect(() => {
    if (!visible || !src) return;
    sendYouTubeIframeCommand(iframeRef.current, "setVolume", [volume]);
  }, [src, visible, volume]);

  useEffect(() => {
    if (!visible) return;
    const context = getLastMusicPlaybackContext();
    const contextQuery = context?.query?.trim();
    if (!contextQuery) return;
    setQuery(contextQuery);
    setLastDiscoveryQuery(contextQuery);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    function handleMusicPlaybackDetail(detail: MusicPlaybackEventDetail) {
      aiPickRequestIdRef.current += 1;
      setMessage((current) => (current === MUSIC_AI_PICK_CHOOSING_MESSAGE ? null : current));
      if (detail.type === "cue") {
        if (typeof detail.volume === "number") setVolume(Math.max(0, Math.min(100, Math.trunc(detail.volume))));
        if (detail.track) {
          if (detail.query) setQuery(detail.query);
          const searchQuery = detail.query?.trim() ?? "";
          void playTrack(
            detail.track,
            typeof detail.volume === "number" ? detail.volume : volume,
            musicChoiceExplanation({
              track: detail.track,
              searchQuery,
              intent: detail.intent ?? null,
              fresh: detail.fresh === true,
              usedDiscoveryFallback: false,
            }),
          );
          if (detail.intent) setMessage(`Music Player: ${musicDjIntentLabel(detail.intent)}`);
        } else if (detail.query) {
          setQuery(detail.query);
          void pick(detail.fresh === true, detail.query, detail.intent ?? null, detail.volume ?? null);
        }
      } else if (detail.type === "context") {
        const contextQuery = detail.query?.trim();
        if (contextQuery) {
          setQuery(contextQuery);
          setLastDiscoveryQuery(contextQuery);
          setChoiceExplanation(`Ready to pick music for cue: "${contextQuery}".`);
        } else {
          setQuery("");
          setLastDiscoveryQuery("");
          setChoiceExplanation(NO_MUSIC_CUE_EXPLANATION);
        }
        if (detail.intent) setMessage(`Music Player ready: ${musicDjIntentLabel(detail.intent)}`);
      } else if (detail.type === "volume") {
        if (detail.intent) setMessage(`Music Player volume: ${musicDjIntentLabel(detail.intent)}`);
        void updateVolume(detail.volume);
      } else if (detail.type === "pause") {
        void pause();
      } else if (detail.type === "stop") {
        void stop();
      }
    }

    function onMusicEvent(event: Event) {
      const detail = (event as CustomEvent<MusicPlaybackEventDetail>).detail;
      if (!detail) return;
      if (detail.type === "cue") {
        consumePendingMusicPlaybackCue();
      }
      handleMusicPlaybackDetail(detail);
    }

    window.addEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
    const pendingCue = consumePendingMusicPlaybackCue();
    if (pendingCue) {
      handleMusicPlaybackDetail(pendingCue);
    }
    return () => window.removeEventListener(MUSIC_PLAYBACK_EVENT, onMusicEvent);
  }, [query, recentTrackIds, track, visible, volume]);

  if (!visible) return null;

  const youtubeFrame = src ? (
    <iframe
      ref={iframeRef}
      className={
        resolvedVariant === "toolbar"
          ? "pointer-events-none absolute -left-px -top-px h-px w-px opacity-0"
          : "mb-2 h-24 w-full rounded border-0"
      }
      src={src}
      title="Music Player YouTube player"
      allow="autoplay; encrypted-media"
    />
  ) : null;

  const player = (
    <section
      className="overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] p-2.5 text-[var(--foreground)] shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-2xl"
      title={choiceExplanation}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--muted)]">
            <Volume2 className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{display.title}</div>
            <div className="truncate text-[var(--muted-foreground)]">{displaySubtitle}</div>
          </div>
        </div>
      </div>

      {youtubeFrame}

      <div className="mb-2 flex gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none"
          placeholder="Mood, genre, or YouTube URL"
          title="Type mood text for a YouTube search, or paste a YouTube URL to play it directly."
        />
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => pick(false)}
          disabled={busy}
          aria-label="Search YouTube music from the current mood or URL"
          title="Search YouTube from the mood text, or play the pasted YouTube URL."
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => freshPick()}
          disabled={busy}
          aria-label="Fresh Music Player pick"
          title="Pick a different YouTube result for the same mood."
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={() => (playing ? pause() : resumeOrPick())}
          aria-label={playing ? "Pause Music Player" : "Play Music Player"}
          title={
            playing ? "Pause Music Player" : track ? "Resume Music Player" : "Play a YouTube pick from the current mood"
          }
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] p-1.5"
          onClick={stop}
          aria-label="Stop Music Player"
          title="Stop Music Player"
        >
          <Square className="h-4 w-4" />
        </button>
        <input
          className="min-w-24 flex-1"
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(event) => updateVolume(Number(event.target.value))}
          aria-label="Music Player volume"
          title="Music Player volume"
        />
        <span className="w-8 text-right text-xs text-[var(--muted-foreground)]">{volume}</span>
      </div>
      {message ? <div className="mt-2 line-clamp-2 text-xs text-[var(--muted-foreground)]">{message}</div> : null}
    </section>
  );

  if (resolvedVariant === "toolbar") {
    return (
      <div
        data-component="MusicToolbarPlayer"
        className="relative flex h-9 w-[clamp(16rem,34vw,34rem)] shrink-0 items-center gap-2 overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-2 text-[var(--foreground)] shadow-sm backdrop-blur-xl"
        title={choiceExplanation}
      >
        {youtubeFrame}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
            <Music2 className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs font-medium">{display.title}</div>
            <div className="truncate text-[10px] text-[var(--muted-foreground)]">{displaySubtitle}</div>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          onClick={() => (playing ? pause() : resumeOrPick())}
          aria-label={playing ? "Pause Music Player" : "Play Music Player"}
          title={
            playing ? "Pause Music Player" : track ? "Resume Music Player" : "Play a YouTube pick from the current mood"
          }
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          onClick={stop}
          disabled={!track && !playing}
          aria-label="Stop Music Player"
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          onClick={() => freshPick()}
          disabled={busy}
          aria-label="Fresh Music Player pick"
          title="Pick a different YouTube result for the same mood"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <input
          className="w-20 shrink-0"
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(event) => updateVolume(Number(event.target.value))}
          aria-label="Music Player volume"
          title="Music Player volume"
        />
      </div>
    );
  }

  return <FloatingMusicShell>{player}</FloatingMusicShell>;
}

export function MusicToolbarPlayer() {
  return <MusicMiniPlayer variant="toolbar" />;
}

export function MusicFloatingWidget() {
  return <MusicMiniPlayer variant="floating" />;
}

export function MusicMobileWidget() {
  return <MusicFloatingWidget />;
}
