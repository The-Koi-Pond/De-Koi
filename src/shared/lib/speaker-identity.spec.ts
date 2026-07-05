import { describe, expect, it } from "vitest";

import { normalizeSpeakerName, speakerIdentityEntries } from "./speaker-identity";

describe("speaker identity helpers", () => {
  it("normalizes case and whitespace without inventing aliases", () => {
    expect(normalizeSpeakerName("  The   Archivist ")).toBe("the archivist");
  });

  it("emits only supplied names and aliases with colors", () => {
    expect(
      speakerIdentityEntries([
        { id: "mira", color: "#b58cff", names: ["Mira Vale", "The Archivist", "", "Mira Vale"] },
        { id: "no-color", names: ["No Color"] },
      ]),
    ).toEqual([
      ["Mira Vale", "#b58cff"],
      ["The Archivist", "#b58cff"],
    ]);
  });
});
