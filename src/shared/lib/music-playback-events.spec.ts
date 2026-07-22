import { describe, expect, it } from "vitest";

import {
  dispatchMusicPlaybackEvent,
  getLastMusicPlaybackContext,
  MUSIC_AI_PICK_REQUEST_EVENT,
  requestMusicAiPick,
} from "./music-playback-events";

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

  it.each([
    [-20, 0],
    [150, 100],
    [Number.NaN, 55],
  ])("always dispatches a bounded Fresh Pick volume for %s", (volume, expected) => {
    let receivedVolume: number | undefined;
    const listener = (event: Event) => {
      receivedVolume = (event as CustomEvent<{ volume: number }>).detail.volume;
      event.preventDefault();
    };
    window.addEventListener(MUSIC_AI_PICK_REQUEST_EVENT, listener);
    try {
      requestMusicAiPick({ fresh: true, volume });
    } finally {
      window.removeEventListener(MUSIC_AI_PICK_REQUEST_EVENT, listener);
    }

    expect(receivedVolume).toBe(expected);
  });
});
