import { describe, expect, it } from "vitest";

import {
  buildCharacterMusicPlaybackCue,
  deriveCharacterNowListening,
  formatNowListeningLine,
  parseFavoriteSongsText,
  parseMusicTextList,
  readCharacterMusicProfile,
  serializeFavoriteSongsText,
  serializeMusicTextList,
} from "./character-music-profile";

describe("readCharacterMusicProfile", () => {
  it("returns an empty disabled profile for missing or malformed values", () => {
    expect(readCharacterMusicProfile(null)).toEqual({
      publicListeningEnabled: false,
      favoriteGenres: [],
      favoriteArtists: [],
      favoriteSongs: [],
      vibeNotes: "",
    });
    expect(readCharacterMusicProfile("dream pop")).toEqual({
      publicListeningEnabled: false,
      favoriteGenres: [],
      favoriteArtists: [],
      favoriteSongs: [],
      vibeNotes: "",
    });
  });

  it("sanitizes songs, artists, genres, and vibe notes without duplicates", () => {
    expect(
      readCharacterMusicProfile({
        publicListeningEnabled: true,
        favoriteGenres: ["Synthwave", " synthwave ", "", 12],
        favoriteArtists: ["Akira Yamaoka", "akira yamaoka", "Portishead"],
        favoriteSongs: [
          { title: "Promise", artist: "Akira Yamaoka", url: "https://youtu.be/6qalGezr76o" },
          { title: "Promise", artist: "Akira Yamaoka" },
          { title: "", artist: "Nobody" },
        ],
        vibeNotes: " rainy neon, quiet menace ",
      }),
    ).toEqual({
      publicListeningEnabled: true,
      favoriteGenres: ["Synthwave"],
      favoriteArtists: ["Akira Yamaoka", "Portishead"],
      favoriteSongs: [{ title: "Promise", artist: "Akira Yamaoka", url: "https://youtu.be/6qalGezr76o" }],
      vibeNotes: "rainy neon, quiet menace",
    });
  });
});

describe("deriveCharacterNowListening", () => {
  it("uses a favorite song as the public listening status", () => {
    const listening = deriveCharacterNowListening({
      publicListeningEnabled: true,
      favoriteGenres: ["dark ambient"],
      favoriteArtists: [],
      favoriteSongs: [{ title: "Promise", artist: "Akira Yamaoka" }],
      vibeNotes: "",
    });

    expect(listening).toEqual({
      kind: "song",
      title: "Promise",
      artist: "Akira Yamaoka",
      url: null,
      query: "Promise Akira Yamaoka",
      displayText: "Promise by Akira Yamaoka",
    });
    expect(formatNowListeningLine(listening)).toBe("Listening to: Promise by Akira Yamaoka");
  });

  it("falls back to artist, genre, and vibe search without inventing a song", () => {
    const listening = deriveCharacterNowListening({
      publicListeningEnabled: true,
      favoriteGenres: ["dark cabaret"],
      favoriteArtists: ["The Dresden Dolls"],
      favoriteSongs: [],
      vibeNotes: "dramatic piano after midnight",
    });

    expect(listening).toEqual({
      kind: "taste",
      title: "The Dresden Dolls radio",
      artist: null,
      url: null,
      query: "The Dresden Dolls dark cabaret dramatic piano midnight music",
      displayText: "The Dresden Dolls radio",
    });
    expect(formatNowListeningLine(listening)).toBe("Listening to: The Dresden Dolls radio");
  });

  it("rotates through artist and genre fallback choices by option index", () => {
    const profile = {
      publicListeningEnabled: true,
      favoriteGenres: ["dark cabaret"],
      favoriteArtists: ["The Dresden Dolls", "Portishead"],
      favoriteSongs: [{ title: "Promise", artist: "Akira Yamaoka" }],
      vibeNotes: "",
    };

    expect(deriveCharacterNowListening(profile, 1)?.displayText).toBe("The Dresden Dolls radio");
    expect(deriveCharacterNowListening(profile, 2)?.displayText).toBe("Portishead radio");
    expect(deriveCharacterNowListening(profile, 3)?.displayText).toBe("dark cabaret mix");
  });
  it("returns null when public listening is disabled or no usable music exists", () => {
    expect(
      deriveCharacterNowListening({
        publicListeningEnabled: false,
        favoriteGenres: ["jazz"],
        favoriteArtists: ["Miles Davis"],
        favoriteSongs: [{ title: "Blue in Green" }],
        vibeNotes: "late night",
      }),
    ).toBeNull();
    expect(
      deriveCharacterNowListening({
        publicListeningEnabled: true,
        favoriteGenres: [],
        favoriteArtists: [],
        favoriteSongs: [],
        vibeNotes: "",
      }),
    ).toBeNull();
  });
});

describe("buildCharacterMusicPlaybackCue", () => {
  it("prefers direct song URLs for playback", () => {
    expect(
      buildCharacterMusicPlaybackCue({
        kind: "song",
        title: "Promise",
        artist: "Akira Yamaoka",
        url: "https://youtu.be/6qalGezr76o",
        query: "Promise Akira Yamaoka",
        displayText: "Promise by Akira Yamaoka",
      }),
    ).toEqual({ query: "https://youtu.be/6qalGezr76o" });
  });

  it("uses the derived query when there is no direct URL", () => {
    expect(
      buildCharacterMusicPlaybackCue({
        kind: "taste",
        title: "The Dresden Dolls radio",
        artist: null,
        url: null,
        query: "The Dresden Dolls dark cabaret music",
        displayText: "The Dresden Dolls radio",
      }),
    ).toEqual({ query: "The Dresden Dolls dark cabaret music" });
  });

  it("compacts long vibe notes before using them as Music Player search text", () => {
    const listening = deriveCharacterNowListening(
      {
        publicListeningEnabled: true,
        favoriteGenres: [],
        favoriteArtists: [],
        favoriteSongs: [],
        vibeNotes:
          "Canon does not state Mira's exact listening habits, so this read extrapolates from her night-radio work and guarded loyalty. She plays tense mechanical songs after midnight. Hook to cut: the locked radio is Lio's.",
      },
      0,
    );

    expect(listening?.displayText).toBe("music taste mix");
    expect(listening?.query).toBe("she plays tense mechanical songs midnight music");
    expect(listening?.query).not.toContain("Canon does not state");
    expect(listening?.query).not.toContain("Hook to cut");
  });
});

describe("music profile editor text helpers", () => {
  it("parses and serializes favorite songs from one-line editor rows", () => {
    const songs = parseFavoriteSongsText(
      "Promise - Akira Yamaoka | https://youtu.be/6qalGezr76o\nDigital Love - Daft Punk\nUntitled",
    );

    expect(songs).toEqual([
      { title: "Promise", artist: "Akira Yamaoka", url: "https://youtu.be/6qalGezr76o" },
      { title: "Digital Love", artist: "Daft Punk" },
      { title: "Untitled" },
    ]);
    expect(serializeFavoriteSongsText(songs)).toBe(
      "Promise - Akira Yamaoka | https://youtu.be/6qalGezr76o\nDigital Love - Daft Punk\nUntitled",
    );
  });

  it("parses and serializes comma or newline separated taste lists", () => {
    expect(parseMusicTextList("synthwave, dark ambient\nsynthwave")).toEqual(["synthwave", "dark ambient"]);
    expect(serializeMusicTextList(["synthwave", "dark ambient"])).toBe("synthwave, dark ambient");
  });
});

