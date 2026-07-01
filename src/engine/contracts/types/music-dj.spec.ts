import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TOOLS, BUILT_IN_AGENTS } from "./agent";
import type { MusicDjIntent, MusicDjTrack } from "./music-dj";

describe("Music DJ contracts", () => {
  it("defines Assistant DJ as the default built-in music agent", () => {
    const dj = BUILT_IN_AGENTS.find((agent) => agent.id === "music-dj");

    expect(dj).toMatchObject({
      id: "music-dj",
      name: "Assistant DJ",
      phase: "post_processing",
      category: "misc",
    });
    expect(DEFAULT_AGENT_TOOLS["music-dj"]).toEqual([
      "music_get_current_playback",
      "music_resolve_candidates",
      "music_play",
      "music_set_volume",
      "music_feedback",
    ]);
  });

  it("keeps the YouTube track identifier separate from display metadata", () => {
    const intent: MusicDjIntent = {
      provider: "youtube",
      mode: "roleplay",
      sceneText: "quiet storm at the manor",
      activeCharacterIds: ["vesper"],
      avoidVideoIds: ["abc123"],
    };
    const track: MusicDjTrack = {
      provider: "youtube",
      videoId: "def456",
      title: "Rain Over the Manor",
      channel: "Ambient Archive",
      durationSeconds: 3600,
      thumbnailUrl: "https://img.youtube.com/vi/def456/hqdefault.jpg",
      score: 92,
      reason: "dark ambient manor rain",
    };

    expect(intent.avoidVideoIds).toEqual(["abc123"]);
    expect(track.videoId).toBe("def456");
  });
});
