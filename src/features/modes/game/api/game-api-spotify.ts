import * as g from "./game-api-support";
import { gameSpotifySourceSettings, recentSpotifyTracks, spotifyQuery } from "./game-api-spotify-helpers";

function spotifyLimit(value: unknown): number {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(50, Math.round(limit)));
}

function isSpotifyDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /spotify.*(not connected|not configured)|no spotify (refresh token|client id) configured/i.test(message);
}

export async function spotifyCandidates(payload: Record<string, unknown>) {
  try {
    const source = await gameSpotifySourceSettings(payload);
    return await g.spotifyApi.searchTracks({
      query: spotifyQuery(payload),
      limit: spotifyLimit(payload.limit),
      recentTrackUris: recentSpotifyTracks(payload),
      ...source,
    });
  } catch (error) {
    if (!isSpotifyDisabledError(error)) throw error;
    return { enabled: false, tracks: [], error: error instanceof Error ? error.message : "Spotify search failed" };
  }
}

export async function spotifyPlay(payload: { track: unknown; deviceId?: string | null }) {
  return g.spotifyApi.playTrack(payload as Record<string, unknown>);
}
