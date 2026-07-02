import { describe, expect, it } from "vitest";

import { dispatchMusicPlaybackEvent, getLastMusicPlaybackContext } from "./music-playback-events";

describe("music playback events", () => {
  it("remembers the latest context event for players that mount later", () => {
    dispatchMusicPlaybackEvent({
      type: "context",
      query: "somber forest cabin cinematic roleplay instrumental ambience soundtrack",
      intent: {
        mood: "somber",
        setting: "forest cabin",
        intensity: "low",
        constraints: ["instrumental"],
        reason: "Loaded roleplay transcript.",
      },
    });

    expect(getLastMusicPlaybackContext()?.query).toContain("forest cabin");
  });
});
