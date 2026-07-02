import { describe, expect, it } from "vitest";

import { getMusicPlayerDisplay } from "./music-player-display";

describe("music player display", () => {
  it("shows the active track title and YouTube channel in compact players", () => {
    expect(
      getMusicPlayerDisplay({
        provider: "youtube",
        id: "youtube:dQw4w9WgXcQ",
        title: "Quiet Tavern Ambience",
        channelOrArtist: "Fantasy Soundscapes",
      }),
    ).toEqual({
      title: "Quiet Tavern Ambience",
      subtitle: "Fantasy Soundscapes",
    });
  });

  it("uses neutral Music DJ fallback text before a track is selected", () => {
    expect(getMusicPlayerDisplay(null)).toEqual({
      title: "Music DJ",
      subtitle: "YouTube first",
    });
  });
});
