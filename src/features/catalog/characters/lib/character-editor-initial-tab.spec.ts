import { describe, expect, it } from "vitest";
import { initialCharacterEditorTab } from "./character-editor-model";

const blank = { description: "", personality: "", scenario: "", first_mes: "" };

// A new character opened on Metadata (creator, version, music taste) instead of where you write who they are.
describe("initialCharacterEditorTab", () => {
  it("opens a blank new character on Description", () => {
    expect(initialCharacterEditorTab(blank)).toBe("description");
    expect(initialCharacterEditorTab({ ...blank, description: "   " })).toBe("description");
  });

  it.each(["description", "personality", "scenario", "first_mes"] as const)(
    "keeps Metadata once %s has text",
    (field) => {
      expect(initialCharacterEditorTab({ ...blank, [field]: "A grumpy lighthouse keeper." })).toBe("metadata");
    },
  );

  it("falls back to Metadata before the character loads", () => {
    expect(initialCharacterEditorTab(null)).toBe("metadata");
  });
});
