import { describe, expect, it } from "vitest";
import { getPersonaTags, parsePersonaGroups, parsePersonaTags, type PersonaPanelRow } from "./personas-panel-model";

function personaWithTags(tags: unknown): PersonaPanelRow {
  return {
    id: "persona-1",
    name: "Imported Persona",
    avatarPath: null,
    isActive: false,
    tags,
  };
}

describe("persona panel tag normalization", () => {
  it("keeps text tags and ignores malformed imported values", () => {
    const persona = personaWithTags(["valid", 42, null, "also-valid"]);

    expect(parsePersonaTags(persona)).toEqual(["valid", "also-valid"]);
    expect(getPersonaTags([persona])).toEqual(["also-valid", "valid"]);
  });
});

describe("parsePersonaGroups", () => {
  const kai: PersonaPanelRow = { id: "kai", name: "Kai", avatarPath: null, isActive: false };
  const rin: PersonaPanelRow = { id: "rin", name: "Rin", avatarPath: null, isActive: false };

  it("adds no Ungrouped folder while there are no real folders, so the list isn't shown twice", () => {
    expect(parsePersonaGroups([], [kai, rin])).toEqual([]);
  });

  it("collects the personas outside every folder into Ungrouped once real folders exist", () => {
    const groups = parsePersonaGroups([{ id: "main", name: "Main", description: "", personaIds: ["rin"] }], [kai, rin]);

    expect(groups.map((group) => [group.name, group.memberIds])).toEqual([
      ["Main", ["rin"]],
      ["Ungrouped", ["kai"]],
    ]);
    expect(groups[1]?.isSynthetic).toBe(true);
  });
});
