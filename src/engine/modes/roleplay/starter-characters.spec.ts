import { describe, expect, it } from "vitest";

import { lintCharacterCard } from "../../entities/character-card-lint";
import { ROLEPLAY_STARTER_CHARACTERS } from "./starter-characters";

describe("roleplay starter characters", () => {
  it("each has a unique id and everything a first scene needs", () => {
    const ids = ROLEPLAY_STARTER_CHARACTERS.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      for (const field of ["name", "hook", "description", "personality", "scenario", "firstMessage"] as const) {
        expect(starter[field].trim(), `${starter.id}.${field}`).not.toBe("");
      }
    }
  });

  it("each greeting ends by asking the player something", () => {
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      const lastParagraph =
        starter.firstMessage
          .trim()
          .split(/\n\s*\n/)
          .at(-1) ?? "";
      expect(lastParagraph, starter.id).toContain("?");
    }
  });

  it("passes De-Koi's own card check", () => {
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      const findings = lintCharacterCard({
        name: starter.name,
        description: starter.description,
        personality: starter.personality,
        scenario: starter.scenario,
        first_mes: starter.firstMessage,
      });
      expect(findings, starter.id).toEqual([]);
    }
  });
});
