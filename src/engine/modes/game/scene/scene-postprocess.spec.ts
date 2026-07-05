import { afterEach, describe, expect, it, vi } from "vitest";

import { postProcessSceneResult } from "./scene-postprocess";

function rawScene(overrides: Record<string, unknown> = {}) {
  return {
    summary: "A quiet room.",
    location: "Study",
    background: null,
    weather: null,
    timeOfDay: null,
    directions: [],
    segments: [],
    music: null,
    ambient: null,
    musicGenre: null,
    musicIntensity: null,
    locationKind: "interior",
    musicTrack: null,
    spotifyTrack: null,
    ...overrides,
  } as never;
}

describe("postProcessSceneResult music contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when Music Player and legacy Spotify scene music are both enabled", () => {
    expect(() =>
      postProcessSceneResult(rawScene(), {
        availableBackgrounds: [],
        availableSfx: [],
        validWidgetIds: new Set(),
        characterNames: [],
        useMusicDj: true,
        useSpotifyMusic: true,
      }),
    ).toThrow("Music Player and legacy Spotify scene music cannot both be enabled");
  });

  it("warns and drops invented Music Player track ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = postProcessSceneResult(rawScene({ musicTrack: "yt:invented" }), {
      availableBackgrounds: [],
      availableSfx: [],
      validWidgetIds: new Set(),
      characterNames: [],
      useMusicDj: true,
      availableMusicTracks: [{ provider: "youtube", id: "yt:real", title: "Rain Waltz" }],
    });

    expect(result.musicTrack).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('musicTrack: "yt:invented" -> null'));
  });
});

