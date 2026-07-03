import { describe, expect, it } from "vitest";

import { gameCarryoverPatch, gameSetupMetadataPatch } from "./game-api-session-helpers";
import type { GameSetupConfig } from "./game-api-support";

function baseConfig(overrides: Partial<GameSetupConfig> = {}): GameSetupConfig {
  return {
    genre: "Fantasy",
    setting: "A rainy port city",
    tone: "Mysterious",
    difficulty: "Normal",
    playerGoals: "Find the missing captain",
    gmMode: "standalone",
    rating: "sfw",
    partyCharacterIds: [],
    ...overrides,
  };
}

describe("gameSetupMetadataPatch", () => {
  it("strips legacy Spotify fields when Music Player is enabled", () => {
    const patch = gameSetupMetadataPatch(
      baseConfig({
        enableMusicDj: true,
        enableSpotifyDj: true,
        spotifySourceType: "playlist",
        spotifyPlaylistId: "playlist-1",
        spotifyPlaylistName: "Old playlist",
        spotifyArtist: "Old artist",
      }),
    );

    expect(patch).toMatchObject({
      gameUseMusicDj: true,
      gameMusicProvider: "youtube",
      gameUseSpotifyMusic: false,
      gameSpotifySourceType: null,
      gameSpotifyPlaylistId: null,
      gameSpotifyPlaylistName: null,
      gameSpotifyArtist: null,
    });
    expect(patch.gameSetupConfig).not.toHaveProperty("enableSpotifyDj");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifySourceType");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyPlaylistId");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyPlaylistName");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyArtist");
  });

  it("strips legacy Spotify fields from carried-over Music Player setup config", () => {
    const patch = gameCarryoverPatch({
      gameUseMusicDj: true,
      gameUseSpotifyMusic: true,
      gameSpotifySourceType: "playlist",
      gameSpotifyPlaylistId: "playlist-1",
      gameSpotifyPlaylistName: "Old playlist",
      gameSpotifyArtist: "Old artist",
      gameSetupConfig: baseConfig({
        enableMusicDj: true,
        enableSpotifyDj: true,
        spotifySourceType: "playlist",
        spotifyPlaylistId: "playlist-1",
        spotifyPlaylistName: "Old playlist",
        spotifyArtist: "Old artist",
      }),
    });

    expect(patch).toMatchObject({
      gameUseMusicDj: true,
      gameUseSpotifyMusic: false,
      gameSpotifySourceType: null,
      gameSpotifyPlaylistId: null,
      gameSpotifyPlaylistName: null,
      gameSpotifyArtist: null,
    });
    expect(patch.gameSetupConfig).not.toHaveProperty("enableSpotifyDj");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifySourceType");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyPlaylistId");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyPlaylistName");
    expect(patch.gameSetupConfig).not.toHaveProperty("spotifyArtist");
  });
});
