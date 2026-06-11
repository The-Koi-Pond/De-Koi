import * as g from "./game-api-support";

export function spotifyQuery(payload: Record<string, unknown>): string {
  const text = [payload.narration, payload.playerAction]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const words = text
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 3)
    .slice(0, 8);
  return words.length ? words.join(" ") : "cinematic adventure soundtrack";
}

export function recentSpotifyTracks(payload: Record<string, unknown>): string[] {
  const context = g.asRecord(payload.context);
  return Array.isArray(context.recentSpotifyTracks)
    ? context.recentSpotifyTracks.filter(
        (uri): uri is string => typeof uri === "string" && uri.startsWith("spotify:track:"),
      )
    : [];
}

export async function gameSpotifySourceSettings(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const chatId = g.readTrimmed(payload.chatId);
  if (!chatId) return {};
  const meta = g.chatMeta(await g.getChat(chatId));
  const setup = g.asRecord(meta.gameSetupConfig);
  const sourceType = g.readTrimmed(meta.gameSpotifySourceType) || g.readTrimmed(setup.spotifySourceType) || "any";
  return {
    sourceType,
    playlistId: g.readTrimmed(meta.gameSpotifyPlaylistId) || g.readTrimmed(setup.spotifyPlaylistId) || null,
    playlistName: g.readTrimmed(meta.gameSpotifyPlaylistName) || g.readTrimmed(setup.spotifyPlaylistName) || null,
    artist: g.readTrimmed(meta.gameSpotifyArtist) || g.readTrimmed(setup.spotifyArtist) || null,
  };
}
