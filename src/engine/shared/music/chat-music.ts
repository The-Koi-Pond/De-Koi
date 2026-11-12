import { isRecord } from "../value-readers";
// Per-chat Music Player data in chat metadata: where Spotify picks come from
// (`musicSpotifySource`) and the recently played history (`musicRecentTracks`),
// including how the older Spotify metadata keys are read.

type JsonRecord = Record<string, unknown>;

/** Where a chat's Spotify candidates come from. */
export type ChatSpotifySource =
  | { type: "liked" }
  | { type: "playlist"; playlistId: string; playlistName?: string | null }
  | { type: "artist"; artist: string }
  | { type: "anything" };

/** One recently played track. `id` is a Spotify track URI or a YouTube video ID. */
export interface MusicRecentTrackEntry {
  provider: string;
  id: string;
}

export const MUSIC_SPOTIFY_SOURCE_KEY = "musicSpotifySource";
export const MUSIC_RECENT_TRACKS_KEY = "musicRecentTracks";
export const MUSIC_RECENT_TRACKS_LIMIT = 24;

const LIKED_SONGS: ChatSpotifySource = { type: "liked" };
const LEGACY_RECENT_TRACK_KEYS = ["spotifyRecentTracks", "gameRecentSpotifyTracks"] as const;

function metadataRecord(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceFrom(
  type: string,
  values: { playlistId?: unknown; playlistName?: unknown; artist?: unknown },
): ChatSpotifySource {
  if (type === "playlist") {
    const playlistId = text(values.playlistId);
    if (!playlistId) return LIKED_SONGS;
    const playlistName = text(values.playlistName);
    return playlistName ? { type: "playlist", playlistId, playlistName } : { type: "playlist", playlistId };
  }
  if (type === "artist") {
    const artist = text(values.artist);
    return artist ? { type: "artist", artist } : LIKED_SONGS;
  }
  if (type === "anything" || type === "any" || type === "search") return { type: "anything" };
  return LIKED_SONGS;
}

/**
 * The chat's own Spotify source setting: the `musicSpotifySource` object, or the
 * older `spotifySourceType` keys when the chat has no new value. Null when the
 * chat never chose one.
 */
export function chatSpotifySourceSetting(metadata: unknown): ChatSpotifySource | null {
  const meta = metadataRecord(metadata);
  const stored = meta[MUSIC_SPOTIFY_SOURCE_KEY];
  if (isRecord(stored) && text(stored.type)) return sourceFrom(text(stored.type), stored);
  const legacyType = text(meta.spotifySourceType);
  if (!legacyType) return null;
  return sourceFrom(legacyType, {
    playlistId: meta.spotifyPlaylistId,
    playlistName: meta.spotifyPlaylistName,
    artist: meta.spotifyArtist,
  });
}

/** Where the chat's Spotify picks come from. Liked Songs unless the chat chose otherwise. */
export function readChatSpotifySource(metadata: unknown): ChatSpotifySource {
  return chatSpotifySourceSetting(metadata) ?? LIKED_SONGS;
}

function entryFrom(value: unknown, legacySpotify: boolean): MusicRecentTrackEntry | null {
  if (legacySpotify && typeof value === "string") {
    const id = value.trim();
    return id ? { provider: "spotify", id } : null;
  }
  if (!isRecord(value)) return null;
  const id = text(value.id) || (legacySpotify ? text(value.uri) : "");
  const provider = legacySpotify ? "spotify" : text(value.provider);
  return id && provider ? { provider, id } : null;
}

function uniqueEntries(entries: MusicRecentTrackEntry[]): MusicRecentTrackEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = `${entry.provider}\u0000${entry.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MUSIC_RECENT_TRACKS_LIMIT);
}

/**
 * The chat's recently played tracks, newest first. A chat without a
 * `musicRecentTracks` list yet reads its older Spotify history as Spotify entries.
 */
export function readChatMusicRecentTracks(metadata: unknown): MusicRecentTrackEntry[] {
  const meta = metadataRecord(metadata);
  const stored = meta[MUSIC_RECENT_TRACKS_KEY];
  if (Array.isArray(stored)) {
    return uniqueEntries(stored.map((value) => entryFrom(value, false)).filter((entry) => entry !== null));
  }
  const legacy = LEGACY_RECENT_TRACK_KEYS.flatMap((key) => (Array.isArray(meta[key]) ? (meta[key] as unknown[]) : []));
  return uniqueEntries(legacy.map((value) => entryFrom(value, true)).filter((entry) => entry !== null));
}

/** The history with `track` added as the newest entry, without duplicates, keeping 24. */
export function withMusicRecentTrack(
  history: MusicRecentTrackEntry[],
  track: MusicRecentTrackEntry,
): MusicRecentTrackEntry[] {
  return uniqueEntries([{ provider: track.provider, id: track.id }, ...history]);
}
