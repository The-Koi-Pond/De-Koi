import { describe, expect, it } from "vitest";

import {
  illustrationReferenceNameAliases,
  illustrationSubjectMatches,
  normalizeIllustrationReferenceName,
} from "./illustration-reference-matching";

describe("illustration reference matching", () => {
  it("normalizes names and builds aliases for titled or parenthetical names", () => {
    expect(normalizeIllustrationReferenceName("Dr. Élodie Vance (Winter Coat)")).toBe(
      "dr elodie vance winter coat",
    );
    expect(illustrationReferenceNameAliases("Dr. Élodie Vance (Winter Coat)")).toEqual(
      expect.arrayContaining(["dr elodie vance winter coat", "dr elodie vance", "elodie", "vance"]),
    );
  });

  it("matches explicit requested names without falling back to every chat character", () => {
    expect(
      illustrationSubjectMatches(
        { name: "Mira Stone" },
        { requestedNames: ["Mira"], prompt: "A quiet tavern scene." },
      ),
    ).toBe(true);
    expect(
      illustrationSubjectMatches(
        { name: "Cass Vale" },
        { requestedNames: ["Mira"], prompt: "A quiet tavern scene." },
      ),
    ).toBe(false);
  });

  it("matches prompt aliases on word boundaries only", () => {
    expect(
      illustrationSubjectMatches(
        { name: "Captain Vale" },
        { prompt: "Captain Vale stands beside the burning gate." },
      ),
    ).toBe(true);
    expect(illustrationSubjectMatches({ name: "Ann" }, { prompt: "An ancient ruin at dusk." })).toBe(false);
    expect(illustrationSubjectMatches({ name: "Hero" }, { prompt: "A heroic victory banner." })).toBe(false);
  });

  it("keeps 3-letter given-name aliases for multi-word subjects", () => {
    expect(illustrationReferenceNameAliases("Ren Vale")).toEqual(expect.arrayContaining(["ren", "vale"]));
    expect(illustrationSubjectMatches({ name: "Ren Vale" }, { prompt: "Ren enters the hall." })).toBe(true);
  });

  it("returns false when no requested name or prompt alias matches", () => {
    expect(illustrationSubjectMatches({ name: "Mira Stone" }, { prompt: "A moonlit empty street." })).toBe(false);
  });
});
