import { describe, expect, it } from "vitest";

import { filterPlayerPersonaPresentCharacters } from "./present-character-filter";

describe("filterPlayerPersonaPresentCharacters", () => {
  it("filters present characters that identify the player through characterIds arrays", () => {
    const rows = [
      { name: "Masked Hero", characterIds: ["persona-1"], mood: "ready" },
      { name: "Mira", characterIds: ["character-1"], mood: "watchful" },
    ];

    expect(filterPlayerPersonaPresentCharacters(rows, { personaId: "persona-1", name: "Xel" })).toEqual([
      rows[1],
    ]);
  });

  it("normalizes JSON-string characterIds from imported tracker rows", () => {
    const rows = [
      { name: "Imported Hero", characterIds: '["persona-1"]' },
      { name: "Imported Ally", characterIds: '["character-1"]' },
    ];

    expect(filterPlayerPersonaPresentCharacters(rows, { id: "persona-1", name: "Xel" })).toEqual([rows[1]]);
  });
});
