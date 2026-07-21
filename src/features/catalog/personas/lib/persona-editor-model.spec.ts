import { describe, expect, it } from "vitest";
import { buildPersonaFormData, type PersonaRow } from "./persona-editor-model";

function personaWithTags(tags: unknown): PersonaRow {
  return {
    id: "persona-1",
    name: "Imported Persona",
    description: "",
    personality: "",
    scenario: "",
    backstory: "",
    appearance: "",
    avatarPath: null,
    isActive: false,
    tags,
  };
}

describe("persona editor tag normalization", () => {
  it("keeps text tags and ignores malformed imported values", () => {
    const formData = buildPersonaFormData(personaWithTags(["valid", 42, null, "also-valid"]));

    expect(formData.tags).toEqual(["valid", "also-valid"]);
  });
});
