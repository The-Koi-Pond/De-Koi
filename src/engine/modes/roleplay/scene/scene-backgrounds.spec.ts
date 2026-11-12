import { describe, expect, it } from "vitest";

import { normalizeSceneBackgrounds, pickSceneBackground } from "./scene-backgrounds";

const SCENES = normalizeSceneBackgrounds([
  { background: "home.webp", name: "Home", keywords: ["apartment", "desk", "couch"] },
  { background: "street.webp", name: "Street", keywords: ["alley", "cobblestone", "archway", "puddle"] },
  { background: "market.webp", name: "Market", keywords: ["market", "stall", "vendor", "awning"] },
]);

describe("scene backgrounds", () => {
  it("drops entries without a background or keywords, and duplicates", () => {
    expect(
      normalizeSceneBackgrounds([
        { background: "a.webp", keywords: ["Alley", " alley "] },
        { background: "", keywords: ["x"] },
        { background: "b.webp", keywords: [] },
        { background: "a.webp", keywords: ["other"] },
        "junk",
      ]),
    ).toEqual([{ background: "a.webp", name: "a.webp", keywords: ["alley"] }]);
  });

  it("moves when a reply clearly puts the story somewhere else", () => {
    const reply = "You step into the alley. Cobblestones shine with rain, and puddles catch the lantern light.";
    expect(pickSceneBackground(SCENES, "home.webp", reply)).toBe("street.webp");
  });

  it("starts from no background", () => {
    expect(pickSceneBackground(SCENES, null, "A vendor waves you over to her stall.")).toBe("market.webp");
  });

  it("stays put on a single passing mention", () => {
    expect(pickSceneBackground(SCENES, "home.webp", "She says the market opens after midnight.")).toBeNull();
  });

  it("stays put while the current scene is mentioned at least as much", () => {
    const reply = "Back at the apartment you drop onto the couch and talk about the market stall.";
    expect(pickSceneBackground(SCENES, "home.webp", reply)).toBeNull();
  });

  it("matches whole words only", () => {
    expect(pickSceneBackground(SCENES, "home.webp", "The supermarket's installation was stalled.")).toBeNull();
  });

  it("never replaces a background the user picked", () => {
    const reply = "You step into the alley. Cobblestones shine with rain.";
    expect(pickSceneBackground(SCENES, "my-own-wallpaper.png", reply)).toBeNull();
  });
});
