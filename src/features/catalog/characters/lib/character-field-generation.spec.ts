import { describe, expect, it } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import {
  buildCharacterFieldGenerationMessages,
  cleanGeneratedCharacterField,
  generateCharacterField,
  type CharacterFieldGenerationField,
} from "./character-field-generation";

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

describe("buildCharacterFieldGenerationMessages", () => {
  it("asks for one requested field using current character context", () => {
    const messages = buildCharacterFieldGenerationMessages("first_mes", {
      data: characterData(),
      comment: "Night-shift archive keeper",
    });

    expect(messages[0]?.content).toContain("creative character card editor");
    expect(messages[1]?.content).toContain("Requested field: First Message");
    expect(messages[1]?.content).toContain("Night-shift archive keeper");
    expect(messages[1]?.content).toContain("tragically, yes");
    expect(messages[1]?.content).toContain("Return only the requested field");
  });

  it("uses depth prompt settings instructions for the depth prompt field", () => {
    const messages = buildCharacterFieldGenerationMessages("depth_prompt", {
      data: characterData(),
      comment: "",
    });

    expect(messages[1]?.content).toContain("Requested field: Depth Prompt");
    expect(messages[1]?.content).toContain('"prompt"');
    expect(messages[1]?.content).toContain('"depth"');
    expect(messages[1]?.content).toContain('"role"');
  });

  it("asks for one music taste field using current character context", () => {
    const messages = buildCharacterFieldGenerationMessages("music_favorite_artists", {
      data: characterData({
        extensions: {
          ...characterData().extensions,
          musicProfile: {
            publicListeningEnabled: true,
            favoriteArtists: ["Portishead"],
            favoriteGenres: ["trip-hop"],
            favoriteSongs: [{ title: "Roads", artist: "Portishead" }],
            vibeNotes: "rain on glass",
          },
        },
      }),
      comment: "Night-shift archive keeper",
    });

    expect(messages[1]?.content).toContain("Requested field: Favorite Music Artists");
    expect(messages[1]?.content).toContain("Portishead");
    expect(messages[1]?.content).toContain("trip-hop");
    expect(messages[1]?.content).toContain("rain on glass");
    expect(messages[1]?.content).toContain("Return only the requested field");
  });
  it("gives creator notes enough budget to finish complete practical notes", async () => {
    const requests: unknown[] = [];
    const value = await generateCharacterField({
      field: "creator_notes",
      data: characterData(),
      comment: "",
      connectionId: "test-connection",
      llm: {
        async *stream(request) {
          requests.push(request);
          yield { type: "token", text: "Use this card for tense mystery scenes." };
        },
      },
    });

    const request = requests[0] as { messages: { content: string }[]; parameters: { maxTokens: number } };
    expect(value).toBe("Use this card for tense mystery scenes.");
    expect(request.messages[1]?.content).toContain("a few simple sentences");
    expect(request.messages[1]?.content).toContain("complete");
    expect(request.parameters.maxTokens).toBeGreaterThanOrEqual(1024);
  });
});

describe("cleanGeneratedCharacterField", () => {
  it("extracts labelled or JSON text for ordinary text fields", () => {
    expect(cleanGeneratedCharacterField("scenario", "```text\nScenario: A rain-slick station platform.\n```")).toBe(
      "A rain-slick station platform.",
    );
    expect(cleanGeneratedCharacterField("personality", '{ "personality": "Warm, sharp, and restless." }')).toBe(
      "Warm, sharp, and restless.",
    );
  });

  it("normalizes generated tags into unique tag names", () => {
    expect(cleanGeneratedCharacterField("tags", '{ "tags": ["Mystery", "#Archivist", "mystery", ""] }')).toEqual([
      "Mystery",
      "Archivist",
    ]);
    expect(cleanGeneratedCharacterField("tags", '["horror", "monster", "yandere", "medical"]')).toEqual([
      "horror",
      "monster",
      "yandere",
      "medical",
    ]);
    expect(cleanGeneratedCharacterField("tags", "['circus', 'dominant']")).toEqual(["circus", "dominant"]);
    expect(cleanGeneratedCharacterField("tags", "mystery, night shift\narchive-keeper")).toEqual([
      "mystery",
      "night shift",
      "archive-keeper",
    ]);
  });

  it("normalizes generated music taste fields", () => {
    expect(cleanGeneratedCharacterField("music_favorite_artists", '["Portishead", "Akira Yamaoka", "portishead"]')).toEqual([
      "Portishead",
      "Akira Yamaoka",
    ]);
    expect(cleanGeneratedCharacterField("music_favorite_genres", "dark ambient, trip-hop\nindustrial")).toEqual([
      "dark ambient",
      "trip-hop",
      "industrial",
    ]);
    expect(
      cleanGeneratedCharacterField(
        "music_favorite_songs",
        '{ "favoriteSongs": [{ "title": "Roads", "artist": "Portishead" }, { "title": "Promise", "artist": "Akira Yamaoka" }] }',
      ),
    ).toEqual([
      { title: "Roads", artist: "Portishead" },
      { title: "Promise", artist: "Akira Yamaoka" },
    ]);
    expect(cleanGeneratedCharacterField("music_vibe_notes", "Vibe Notes: rainy neon, broken radio romance")).toBe(
      "rainy neon, broken radio romance",
    );
  });

  it("normalizes generated depth prompt text and settings", () => {
    expect(
      cleanGeneratedCharacterField(
        "depth_prompt",
        '{ "prompt": "Remember the locked wing.", "depth": 6, "role": "assistant" }',
      ),
    ).toEqual({
      prompt: "Remember the locked wing.",
      depth: 6,
      role: "assistant",
    });

    expect(cleanGeneratedCharacterField("depth_prompt", "Depth Prompt: Keep the bargain secret.")).toEqual({
      prompt: "Keep the bargain secret.",
      depth: 4,
      role: "system",
    });
  });

  it.each([
    "description",
    "personality",
    "backstory",
    "appearance",
    "scenario",
    "first_mes",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "creator_notes",
    "music_vibe_notes",
  ] satisfies CharacterFieldGenerationField[])("returns strings for %s", (field) => {
    expect(cleanGeneratedCharacterField(field, "Generated value")).toBe("Generated value");
  });
});
