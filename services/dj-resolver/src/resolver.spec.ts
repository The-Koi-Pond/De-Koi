import { describe, expect, it } from "vitest";
import { buildYouTubeQueries, rankYouTubeCandidates, resolveMusicDjIntent } from "./resolver";
import type { MusicDjIntent, YouTubeSearchItem } from "./types";

const gothicIntent: MusicDjIntent = {
  provider: "youtube",
  mode: "roleplay",
  sceneText: "A melancholic vampire prince asks the player to dance in a candlelit ballroom.",
  characters: [{ id: "vesper", name: "Vesper", description: "Elegant, haunted, romantic vampire prince." }],
  persona: { id: "persona", name: "Celia", description: "Curious and gentle." },
  hints: { mood: "gothic romance", energy: "low", vocals: "instrumental", duration: "song" },
  avoidVideoIds: ["recent-id"],
};

function item(id: string, title: string, durationSeconds: number, embeddable = true): YouTubeSearchItem {
  return {
    videoId: id,
    title,
    channel: "Library of Scores",
    durationSeconds,
    thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    embeddable,
  };
}

describe("Music DJ YouTube resolver", () => {
  it("builds roleplay-aware YouTube queries from scene and character intent", () => {
    expect(buildYouTubeQueries(gothicIntent)).toEqual([
      "gothic romance instrumental vampire prince ballroom music",
      "melancholic elegant instrumental roleplay soundtrack",
      "candlelit ballroom gothic waltz instrumental",
    ]);
  });

  it("filters unsuitable YouTube candidates and ranks fitting tracks first", () => {
    const ranked = rankYouTubeCandidates(gothicIntent, [
      item("recent-id", "Perfect but recently played", 240),
      item("blocked-id", "Gothic Ballroom Waltz", 240, false),
      item("short-id", "Gothic Sting", 24),
      item("mix-id", "Eight Hour Vampire Ambience Mix", 8 * 60 * 60),
      item("fit-id", "Gothic Ballroom Waltz Instrumental", 246),
      item("okay-id", "Sad Piano Instrumental", 220),
    ]);

    expect(ranked.map((track) => track.videoId)).toEqual(["fit-id", "okay-id"]);
    expect(ranked[0]).toMatchObject({
      provider: "youtube",
      videoId: "fit-id",
      score: expect.any(Number),
      reason: expect.stringContaining("gothic romance"),
    });
  });

  it("returns an unavailable response when YouTube search fails", async () => {
    const response = await resolveMusicDjIntent(gothicIntent, {
      search: async () => {
        throw new Error("quota exceeded");
      },
    });

    expect(response).toEqual({
      available: false,
      provider: "youtube",
      tracks: [],
      error: "quota exceeded",
    });
  });
});
