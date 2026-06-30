import { describe, expect, it } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import {
  buildCharacterRpgStatsGenerationMessages,
  cleanGeneratedRpgStatsConfig,
} from "./character-rpg-stats-generation";

function characterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira Vale",
    description: "A city archivist who fights with keys, wards, and careful threats.",
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
        prompt: "",
        depth: 4,
        role: "system",
      },
      backstory: "Mira survived a cursed archive collapse and now treats danger as a bookkeeping problem.",
      appearance: "Silver-streaked hair, ink-stained gloves, and a threadbare coat.",
    },
    character_book: null,
    ...overrides,
  };
}

describe("buildCharacterRpgStatsGenerationMessages", () => {
  it("asks for structured RPG stats using public character context", () => {
    const messages = buildCharacterRpgStatsGenerationMessages({
      data: characterData(),
      comment: "Night-shift archive keeper",
    });

    expect(messages[0]?.content).toContain("RPG stat designer");
    expect(messages[1]?.content).toContain("Night-shift archive keeper");
    expect(messages[1]?.content).toContain("fights with keys");
    expect(messages[1]?.content).toContain('"attributes"');
    expect(messages[1]?.content).not.toContain("Private setup instructions");
  });
});

describe("cleanGeneratedRpgStatsConfig", () => {
  it("normalizes generated HP and attributes into enabled RPG stats", () => {
    expect(
      cleanGeneratedRpgStatsConfig(`{
        "hp": { "max": 72 },
        "attributes": [
          { "name": "Strength", "value": 8 },
          { "name": "DEX", "value": 14 },
          { "name": "WIS", "value": "16" },
          { "name": "DEX", "value": 99 },
          { "name": "", "value": 4 }
        ]
      }`),
    ).toEqual({
      enabled: true,
      hp: { value: 72, max: 72 },
      attributes: [
        { name: "STR", value: 8 },
        { name: "DEX", value: 14 },
        { name: "WIS", value: 16 },
      ],
    });
  });

  it("throws instead of inventing success for unusable output", () => {
    expect(() => cleanGeneratedRpgStatsConfig("not json")).toThrow("valid RPG stats");
    expect(() => cleanGeneratedRpgStatsConfig('{ "hp": {}, "attributes": [] }')).toThrow("valid RPG stats");
  });
});
