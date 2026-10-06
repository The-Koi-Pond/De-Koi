import { describe, expect, it } from "vitest";

import { validateContinuityDirectorBeat } from "./continuity-director-safety";

describe("continuity director beat safety", () => {
  it.each([
    'Celia says, "Give me the map."',
    "Celia: Give me the map.",
    "You draw your sword and attack the captain.",
    "Celia decides to betray Mara.",
    "Celia believes the captain is lying.",
    "Celia plans to poison the well.",
    "Mara asks what Celia wants. Celia decides to betray Mara.",
    "What Celia wants is revenge against the captain.",
  ])("rejects user-authored agency: %s", (text) => {
    expect(validateContinuityDirectorBeat(text, { personaNames: ["Celia"] })).toMatchObject({ safe: false });
  });

  it.each([
    "The bridge collapses, forcing Celia to choose how to respond.",
    "Mara reveals the forged seal.",
    "Celia feels a chill as the door opens.",
    "The watch captain demands an answer from Celia.",
    "Harlequin stages a test of what Celia genuinely wants.",
    "The open question is whether Celia agrees to the truce.",
    "If Celia refuses, the captain will call the guard.",
    "What does Celia want from the captain?",
    "Why does Celia refuse the bargain?",
    "Whether Celia will agree stays open.",
  ])("allows pressure, involuntary response, and non-user action: %s", (text) => {
    expect(validateContinuityDirectorBeat(text, { personaNames: ["Celia"] })).toEqual({ safe: true, reasons: [] });
  });

  it("rejects empty and oversized beats", () => {
    expect(validateContinuityDirectorBeat("   ", { personaNames: [] })).toMatchObject({ safe: false });
    expect(validateContinuityDirectorBeat("x".repeat(281), { personaNames: [] })).toMatchObject({ safe: false });
  });
});
