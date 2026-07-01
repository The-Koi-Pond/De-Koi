import { describe, expect, it } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { buildCharacterLorebookPrompt, characterLorebookName } from "./character-lorebook-generation";

function characterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira Vale",
    description: "A city archivist with too many keys.",
    personality: "Dry, exacting, and allergic to sentiment.",
    scenario: "The archive after midnight.",
    first_mes: "You lost again? Fine. Hand me the map.",
    mes_example: "<START>\n{{user}}: you missed me\n{{char}}: tragically, yes. don't make it weird.",
    creator_notes: "Private setup instructions and model settings.",
    system_prompt: "Stay in character as Mira.",
    post_history_instructions: "Keep replies concise.",
    tags: ["archivist", "mystery"],
    creator: "",
    character_version: "",
    alternate_greetings: [],
    extensions: {
      talkativeness: 0.5,
      fav: false,
      world: "",
      depth_prompt: {
        prompt: "Remember the locked east wing.",
        depth: 4,
        role: "system",
      },
      backstory: "Mira inherited the keys from a vanished mentor.",
      appearance: "Silver-streaked hair, ink-stained gloves, and a threadbare coat.",
    },
    character_book: null,
    ...overrides,
  };
}

describe("buildCharacterLorebookPrompt", () => {
  it("turns a character card into a lorebook-maker brief", () => {
    const prompt = buildCharacterLorebookPrompt(characterData());

    expect(prompt).toContain("Create a lorebook for this character");
    expect(prompt).toContain("Character name:\nMira Vale");
    expect(prompt).toContain("Description:\nA city archivist with too many keys.");
    expect(prompt).toContain("Backstory:\nMira inherited the keys from a vanished mentor.");
    expect(prompt).toContain("Appearance:\nSilver-streaked hair");
    expect(prompt).toContain("Tags:\narchivist, mystery");
    expect(prompt).toContain("Prefer entries that help roleplay");
  });

  it("uses a stable fallback when the character has no name", () => {
    expect(characterLorebookName(characterData({ name: "  " }))).toBe("Character Lorebook");
    expect(buildCharacterLorebookPrompt(characterData({ name: "  " }))).toContain("Character name:\nUnnamed Character");
  });
});
