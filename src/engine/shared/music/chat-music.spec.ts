import { describe, expect, it } from "vitest";

import {
  chatSpotifySourceSetting,
  readChatMusicRecentTracks,
  readChatSpotifySource,
  withMusicRecentTrack,
} from "./chat-music";

describe("chat Spotify source", () => {
  it("defaults to Liked Songs and reads the stored choice", () => {
    expect(readChatSpotifySource({})).toEqual({ type: "liked" });
    expect(chatSpotifySourceSetting({})).toBeNull();
    expect(
      readChatSpotifySource({ musicSpotifySource: { type: "playlist", playlistId: "pl1", playlistName: "Rain" } }),
    ).toEqual({ type: "playlist", playlistId: "pl1", playlistName: "Rain" });
    expect(readChatSpotifySource(JSON.stringify({ musicSpotifySource: { type: "anything" } }))).toEqual({
      type: "anything",
    });
  });

  it("uses Liked Songs when a playlist or artist choice is missing its value", () => {
    expect(readChatSpotifySource({ musicSpotifySource: { type: "playlist" } })).toEqual({ type: "liked" });
    expect(readChatSpotifySource({ musicSpotifySource: { type: "artist", artist: "  " } })).toEqual({ type: "liked" });
  });

  it("reads the older Spotify keys only when the chat has no new value", () => {
    const legacy = { spotifySourceType: "artist", spotifyArtist: "Joe Hisaishi" };
    expect(readChatSpotifySource(legacy)).toEqual({ type: "artist", artist: "Joe Hisaishi" });
    expect(
      readChatSpotifySource({ spotifySourceType: "playlist", spotifyPlaylistId: "pl2", spotifyPlaylistName: "Calm" }),
    ).toEqual({ type: "playlist", playlistId: "pl2", playlistName: "Calm" });
    expect(readChatSpotifySource({ ...legacy, musicSpotifySource: { type: "liked" } })).toEqual({ type: "liked" });
  });
});

describe("chat music recent tracks", () => {
  it("adds the newest track first, without duplicates, keeping 24", () => {
    let history = readChatMusicRecentTracks({});
    for (let index = 0; index < 30; index += 1) {
      history = withMusicRecentTrack(history, { provider: "youtube", id: `video-${index}` });
    }
    history = withMusicRecentTrack(history, { provider: "youtube", id: "video-20" });
    expect(history).toHaveLength(24);
    expect(history[0]).toEqual({ provider: "youtube", id: "video-20" });
    expect(history.filter((entry) => entry.id === "video-20")).toHaveLength(1);
    expect(history[1]).toEqual({ provider: "youtube", id: "video-29" });
  });

  it("keeps the same id from different sources apart", () => {
    const history = withMusicRecentTrack([{ provider: "spotify", id: "x" }], { provider: "youtube", id: "x" });
    expect(history).toEqual([
      { provider: "youtube", id: "x" },
      { provider: "spotify", id: "x" },
    ]);
  });

  it("reads the older Spotify history as Spotify entries when the chat has no list yet", () => {
    expect(
      readChatMusicRecentTracks({
        spotifyRecentTracks: ["spotify:track:a", { uri: "spotify:track:b" }],
        gameRecentSpotifyTracks: ["spotify:track:a", { id: "spotify:track:c" }, 7],
      }),
    ).toEqual([
      { provider: "spotify", id: "spotify:track:a" },
      { provider: "spotify", id: "spotify:track:b" },
      { provider: "spotify", id: "spotify:track:c" },
    ]);
    expect(readChatMusicRecentTracks({ musicRecentTracks: [], spotifyRecentTracks: ["spotify:track:a"] })).toEqual([]);
  });
});
