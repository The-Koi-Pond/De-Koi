import { describe, expect, it } from "vitest";

import type { MusicCandidate } from "../api/music-api";
import { rankMusicCandidates } from "./music-candidate-ranking";

function candidate(id: string, title: string, confidence = 0.5): MusicCandidate {
  return {
    provider: "youtube",
    id,
    title,
    channelOrArtist: "YouTube Channel",
    url: `https://youtu.be/${id}`,
    confidence,
  };
}

describe("rankMusicCandidates", () => {
  it("prefers instrumental scene matches over lyrical or weak matches", () => {
    const ranked = rankMusicCandidates(
      [
        candidate("lyrics", "Quiet tavern love song lyrics", 0.9),
        candidate("scene", "Quiet fantasy tavern instrumental ambience", 0.65),
        candidate("other", "Epic boss battle theme", 0.8),
      ],
      {
        query: "quiet fantasy tavern instrumental ambience",
        intent: {
          mood: "peaceful rest",
          setting: "fantasy tavern",
          intensity: "low",
          constraints: ["instrumental", "ambient", "background"],
        },
      },
    );

    expect(ranked.map((entry) => entry.id)).toEqual(["scene", "lyrics", "other"]);
  });

  it("avoids current and recent tracks when a fresh scene pick is requested", () => {
    const ranked = rankMusicCandidates(
      [
        candidate("current", "Dark forest ambient instrumental", 0.99),
        candidate("recent", "Dark forest ambience no vocals", 0.9),
        candidate("fresh", "Haunted forest drone instrumental", 0.75),
      ],
      {
        query: "dark forest ambient instrumental",
        intent: { mood: "uneasy exploration", setting: "dark forest", intensity: "medium" },
        currentTrackId: "current",
        recentTrackIds: ["recent"],
        fresh: true,
      },
    );

    expect(ranked[0]?.id).toBe("fresh");
  });

  it("normalizes YouTube IDs when avoiding repeat tracks", () => {
    const ranked = rankMusicCandidates(
      [
        { ...candidate("youtube:abc123XYZ09", "Quiet tavern ambience instrumental", 0.99), url: "https://youtu.be/abc123XYZ09" },
        candidate("freshChoice", "Quiet tavern instrumental background", 0.7),
      ],
      {
        query: "quiet tavern instrumental",
        currentTrackId: "abc123XYZ09",
        fresh: true,
      },
    );

    expect(ranked[0]?.id).toBe("freshChoice");
  });
});