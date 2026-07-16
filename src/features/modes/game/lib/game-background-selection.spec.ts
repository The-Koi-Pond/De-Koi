import { describe, expect, it } from "vitest";

import {
  backgroundOptionKey,
  backgroundTagScore,
  getSceneBackgroundTags,
  pickFallbackBackgroundTag,
} from "./game-background-selection";

describe("game background selection", () => {
  const manifest = {
    "backgrounds:desert-dunes": { path: "desert.png" },
    "backgrounds:fantasy:forest-night": { path: "forest.png" },
    "backgrounds:town-day": { path: "town.png" },
    "backgrounds:illustrations:forest-night": { path: "illustration.png" },
    "sprites:forest-night": { path: "sprite.png" },
  };

  it("scores exact and partial words and chooses the strongest requested tag", () => {
    expect(backgroundTagScore("forest night", "backgrounds:fantasy:forest-night")).toBe(11);
    expect(backgroundTagScore("moonlit forest", "backgrounds:fantasy:forest-night")).toBe(6);
    expect(backgroundTagScore("volcano", "backgrounds:fantasy:forest-night")).toBe(0);

    expect(pickFallbackBackgroundTag("forest night", manifest)).toBe("backgrounds:fantasy:forest-night");
    expect(pickFallbackBackgroundTag("moonlit forest", manifest)).toBe("backgrounds:fantasy:forest-night");
  });

  it("falls back to the first hinted tag when the request is empty or unmatched", () => {
    expect(pickFallbackBackgroundTag("volcano", manifest)).toBe("backgrounds:fantasy:forest-night");
    expect(pickFallbackBackgroundTag(null, manifest)).toBe("backgrounds:fantasy:forest-night");
    expect(pickFallbackBackgroundTag("forest", null)).toBeNull();
  });

  it("normalizes option keys and preserves the first scene tag for each key", () => {
    expect(backgroundOptionKey("backgrounds:fantasy:q-abcdef:Forest_Glade")).toBe("forest-glade");

    expect(
      getSceneBackgroundTags([
        "sprites:forest",
        "backgrounds:fantasy:forest-glade",
        "backgrounds:modern:forest_glade",
        "backgrounds:illustrations:forest-glade",
        "backgrounds:user:Town Day",
      ]),
    ).toEqual(["backgrounds:fantasy:forest-glade", "backgrounds:user:Town Day"]);
  });
});
