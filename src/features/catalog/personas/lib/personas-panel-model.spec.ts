import { describe, expect, it } from "vitest";
import { getPersonaTags, parsePersonaTags, type PersonaPanelRow } from "./personas-panel-model";

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
