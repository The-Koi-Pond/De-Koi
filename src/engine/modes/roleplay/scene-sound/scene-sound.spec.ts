import { describe, expect, it } from "vitest";
import { pickSceneAmbient, sceneAmbientFromTracker } from "./scene-ambient";
import { pickReplySoundEffect } from "./scene-effects";

describe("pickSceneAmbient", () => {
  it("follows World State and changes only when the scene does", () => {
    const tavern = { tracker: { location: "The Prancing Pony tavern", weather: "light rain" }, recentReplies: [] };
    expect(pickSceneAmbient(tavern, null)).toBe("tavern");
    // Another reply in the same scene: same bed.
    expect(pickSceneAmbient(tavern, "tavern")).toBe("tavern");
    const road = { tracker: { location: "the north road", weather: "light rain" }, recentReplies: [] };
    expect(pickSceneAmbient(road, "tavern")).toBe("rain");
  });

  it("plays night sounds only outdoors", () => {
    expect(sceneAmbientFromTracker({ location: "an empty field", time: "night" })).toBe("night");
    expect(sceneAmbientFromTracker({ location: "a rehearsal tent", time: "night" })).toBeNull();
  });

  it("without World State, needs the text to clearly name the scene", () => {
    const reply = "Rain hammers the roof. Through the rain, the street lamps blur.";
    expect(pickSceneAmbient({ recentReplies: [reply] }, null)).toBe("rain");
    // One passing mention is not enough.
    expect(pickSceneAmbient({ recentReplies: ["She mentions the rain once."] }, null)).toBeNull();
  });

  it("keeps the bed when a reply doesn't move the scene", () => {
    const replies = ["The circus big top is empty now.", "He leans closer. 'Stay,' he says."];
    expect(pickSceneAmbient({ recentReplies: replies }, "carnival")).toBe("carnival");
    expect(pickSceneAmbient({ recentReplies: ["He nods."] }, "carnival")).toBe("carnival");
    // A tie with the playing bed keeps it.
    const tie = ["Out past the circus tents, the carnival lights die. Rain starts, rain everywhere."];
    expect(pickSceneAmbient({ recentReplies: tie }, "carnival")).toBe("carnival");
  });

  it("switches when the text clearly moves somewhere else", () => {
    const moved = ["They walk out of the woods to the beach.", "Waves break on the shore; the sea is grey."];
    expect(pickSceneAmbient({ recentReplies: moved }, "forest")).toBe("ocean");
  });
});

describe("pickReplySoundEffect", () => {
  it("picks the first clear event in narration", () => {
    const reply = "Thunder cracks overhead. Behind her, the door slams shut.";
    expect(pickReplySoundEffect(reply, null)?.id).toBe("thunder");
  });

  it("never repeats the last effect back to back", () => {
    const reply = "Thunder cracks overhead. Behind her, the door slams shut.";
    expect(pickReplySoundEffect(reply, "thunder")?.id).toBe("door-slam");
    expect(pickReplySoundEffect("Thunder booms again.", "thunder")).toBeNull();
  });

  it("ignores events that are only talked about", () => {
    expect(pickReplySoundEffect('"Did you hear the gunshot last night?" she asks.', null)).toBeNull();
    expect(pickReplySoundEffect("“The glass shattered,” he says quietly.", null)).toBeNull();
  });

  it("plays a written sound cue first", () => {
    const reply = "The door slams.\n[SFX: A music box winding down]\nShe turns.";
    expect(pickReplySoundEffect(reply, null)).toEqual({
      id: "cue:a music box winding down",
      description: "A music box winding down",
    });
  });

  it("finds nothing in a quiet reply", () => {
    expect(pickReplySoundEffect("She smiles and takes his hand.", null)).toBeNull();
  });

  it("ignores figurative events", () => {
    for (const reply of [
      "The long night takes its toll on him.",
      "Her heart shattered at the words.",
      "He exploded with anger.",
      "An explosion of color filled the sky.",
    ]) {
      expect(pickReplySoundEffect(reply, null), reply).toBeNull();
    }
    expect(pickReplySoundEffect("She smashes the bottle against the bar.", null)?.id).toBe("glass-shatter");
    expect(pickReplySoundEffect("The chapel bell tolls midnight.", null)?.id).toBe("bell");
    expect(pickReplySoundEffect("The bomb exploded.", null)?.id).toBe("explosion");
  });
});
