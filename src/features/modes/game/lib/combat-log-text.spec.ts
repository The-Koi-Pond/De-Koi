import { describe, expect, it } from "vitest";
import { speakerTagsToProse } from "./combat-log-text";

describe("speakerTagsToProse", () => {
  it("turns speaker-tagged dialogue lines into plain speaker lines", () => {
    expect(
      speakerTagsToProse('The wall shakes.\n[Pierrot] [main] : "Point."\n[Columbina] [whisper:Chai] [scared]: "Run."'),
    ).toBe('The wall shakes.\nPierrot: "Point."\nColumbina: "Run."');
  });

  it("leaves bracketed words inside prose alone", () => {
    expect(speakerTagsToProse("He reads the sign [faded] and nods.")).toBe("He reads the sign [faded] and nods.");
    expect(speakerTagsToProse("[Quest]: Find the hidden key")).toBe("[Quest]: Find the hidden key");
    expect(speakerTagsToProse("[Quest] [faded]: Find the hidden key")).toBe("[Quest] [faded]: Find the hidden key");
  });
});
