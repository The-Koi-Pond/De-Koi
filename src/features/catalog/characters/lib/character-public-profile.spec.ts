import { describe, expect, it } from "vitest";

import {
  buildCharacterPublicProfileBannerPrompt,
  buildCharacterPublicProfileGenerationMessages,
  cleanGeneratedCharacterPublicProfileField,
  resolveCharacterPublicProfile,
  suggestCharacterPublicProfileField,
} from "./character-public-profile";
import type { CharacterData } from "../../../../engine/contracts/types/character";

function characterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira Vale",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [],
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
      backstory: "",
      appearance: "",
    },
    character_book: null,
    ...overrides,
  };
}

describe("resolveCharacterPublicProfile", () => {
  it("uses saved public profile fields but keeps character-card tags", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-1",
      data: {
        name: "Mira",
        description: "A city archivist with too many keys.",
        tags: ["archivist", "mystery"],
        extensions: {
          publicProfile: {
            displayName: "Mira Voss",
            handle: "@lockbox",
            bio: "Keeps secrets for people who know how to ask.",
            tags: ["quiet", "keys", ""],
            bannerImage: "gallery://banner-1",
          },
        },
      },
      comment: "Night-shift archive keeper",
    });

    expect(profile).toMatchObject({
      displayName: "Mira Voss",
      handle: "@lockbox",
      title: "Night-shift archive keeper",
      bio: "Keeps secrets for people who know how to ask.",
      tags: ["archivist", "mystery"],
      bannerImage: "gallery://banner-1",
      hasSavedProfile: true,
    });
  });

  it("derives a bio from public card personality when description is blank", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-3",
      data: {
        name: "Vera",
        description: "",
        personality: "Warm, exacting, and impossible to rush.",
        creator_notes: "Private setup instructions.",
        extensions: {},
      },
      comment: "",
    });

    expect(profile.bio).toBe("Warm, exacting, and impossible to rush.");
    expect(profile.bio).not.toContain("Private setup");
  });

  it("derives a shallow profile without exposing private creator notes", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-2",
      data: {
        name: "Sol",
        description: "",
        creator_notes: "Private setup instructions and recommended model settings.",
        tags: ["android", "pilot"],
        extensions: {},
      },
      comment: "Orbital courier",
    });

    expect(profile.displayName).toBe("Sol");
    expect(profile.title).toBe("Orbital courier");
    expect(profile.bio).toBe("Orbital courier");
    expect(profile.bio).not.toContain("Private setup instructions");
    expect(profile.tags).toEqual(["android", "pilot"]);
    expect(profile.hasSavedProfile).toBe(false);
  });

  it("includes public music presence only from the explicit music profile", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-4",
      data: {
        name: "Nocturne",
        description: "Haunts the late train platform.",
        creator_notes: "Secretly always humming a forbidden song.",
        extensions: {
          musicProfile: {
            publicListeningEnabled: true,
            favoriteSongs: [{ title: "Shadow Waltz", artist: "The Clockhands" }],
          },
        },
      },
      comment: "",
    });

    expect(profile.nowListening?.displayText).toBe("Shadow Waltz by The Clockhands");
    expect(profile.nowListeningLine).toBe("Listening to: Shadow Waltz by The Clockhands");
    expect(profile.musicOptions.map((option) => option.displayText)).toEqual(["Shadow Waltz by The Clockhands"]);
    expect(profile.musicPickIndex).toBe(0);
    expect(profile.nowListeningLine).not.toContain("forbidden");

    const hidden = resolveCharacterPublicProfile({
      id: "char-5",
      data: {
        name: "Quiet",
        description: "",
        extensions: {
          musicProfile: {
            publicListeningEnabled: false,
            favoriteSongs: [{ title: "Private Track", artist: "Hidden Artist" }],
          },
        },
      },
      comment: "",
    });

    expect(hidden.nowListening).toBeNull();
    expect(hidden.nowListeningLine).toBeNull();
    expect(hidden.musicOptions).toEqual([]);
  });

  it("retains every public music option so profile previews can shuffle locally", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-6",
      data: {
        name: "Rook",
        description: "",
        extensions: {
          musicProfile: {
            publicListeningEnabled: true,
            favoriteSongs: [{ title: "Disciple", artist: "Throbbing Gristle" }],
            favoriteArtists: ["Coil"],
            favoriteGenres: ["industrial"],
            vibeNotes: "coldwave ritual",
          },
        },
      },
      comment: "",
      musicPickIndex: 2,
    });

    expect(profile.musicOptions.map((option) => option.displayText)).toEqual([
      "Disciple by Throbbing Gristle",
      "Coil radio",
      "industrial mix",
      "coldwave ritual mix",
    ]);
    expect(profile.musicPickIndex).toBe(2);
    expect(profile.nowListening?.displayText).toBe("industrial mix");
  });
});

describe("suggestCharacterPublicProfileField", () => {
  it("suggests display name, handle, and bio independently from public-safe character fields", () => {
    const data = characterData({
      name: "Dr. Mira Vale",
      description: "A city archivist with too many keys.\n\nHer deeper secrets stay in the full card.",
      creator_notes: "Private setup instructions and model settings.",
      extensions: {
        talkativeness: 0.5,
        fav: false,
        world: "",
        depth_prompt: {
          prompt: "",
          depth: 4,
          role: "system",
        },
        backstory: "",
        appearance: "",
        publicProfile: {
          displayName: "Mira Vale",
        },
      },
    });

    expect(suggestCharacterPublicProfileField("displayName", { data, comment: "Night-shift archive keeper" })).toBe(
      "Dr. Mira Vale",
    );
    expect(suggestCharacterPublicProfileField("handle", { data, comment: "Night-shift archive keeper" })).toBe(
      "@mira_vale",
    );
    expect(suggestCharacterPublicProfileField("bio", { data, comment: "Night-shift archive keeper" })).toBe(
      "A city archivist with too many keys.",
    );
    expect(suggestCharacterPublicProfileField("bio", { data, comment: "Night-shift archive keeper" })).not.toContain(
      "Private setup",
    );
  });

  it("falls back to safe card fields when the preferred source is blank", () => {
    const data = characterData({
      name: "",
      description: "",
      personality: "Warm, exacting, and impossible to rush.",
      creator_notes: "Private note.",
    });

    expect(suggestCharacterPublicProfileField("displayName", { data, comment: "Night-shift archive keeper" })).toBe(
      "Night-shift archive keeper",
    );
    expect(suggestCharacterPublicProfileField("handle", { data, comment: "Night-shift archive keeper" })).toBe(
      "@night_shift_archive_keeper",
    );
    expect(suggestCharacterPublicProfileField("bio", { data, comment: "Night-shift archive keeper" })).toBe(
      "Warm, exacting, and impossible to rush.",
    );
  });
});
describe("buildCharacterPublicProfileGenerationMessages", () => {
  it("asks for an in-character field using conversation-style card text without creator notes", () => {
    const data = characterData({
      name: "Mira Vale",
      description: "A city archivist with too many keys.",
      personality: "Dry, exacting, and allergic to sentiment.",
      first_mes: "You lost again? Fine. Hand me the map.",
      mes_example: "<START>\n{{user}}: you missed me\n{{char}}: tragically, yes. don't make it weird.",
      creator_notes: "Private setup instructions and model settings.",
    });

    const messages = buildCharacterPublicProfileGenerationMessages("bio", {
      data,
      comment: "Night-shift archive keeper",
    });

    expect(messages[0]?.content).toContain("roleplaying as the character");
    expect(messages[1]?.content).toContain("tragically, yes");
    expect(messages[1]?.content).toContain("Night-shift archive keeper");
    expect(messages[1]?.content).not.toContain("Private setup");
  });

  it("asks for Discord-native self-presentation instead of generic profile copy", () => {
    const messages = buildCharacterPublicProfileGenerationMessages("bio", {
      data: characterData({
        name: "Mira Vale",
        description: "A city archivist with too many keys.",
        personality: "Dry, exacting, and allergic to sentiment.",
        first_mes: "You lost again? Fine. Hand me the map.",
        mes_example: "<START>\n{{user}}: you missed me\n{{char}}: tragically, yes. don't make it weird.",
      }),
      comment: "Night-shift archive keeper",
    });

    expect(messages[0]?.content).toContain("Discord");
    expect(messages[1]?.content).toContain("not a narrator summary");
    expect(messages[1]?.content).toContain("real user");
  });

  it("does not provide the current target field as a value to preserve while regenerating", () => {
    const data = characterData({
      name: "Mira Vale",
      extensions: {
        talkativeness: 0.5,
        fav: false,
        world: "",
        depth_prompt: {
          prompt: "",
          depth: 4,
          role: "system",
        },
        backstory: "",
        appearance: "",
        publicProfile: {
          displayName: "Mira",
          handle: "@mira",
          bio: "I keep the keys.",
        },
      },
    });

    const displayNameMessages = buildCharacterPublicProfileGenerationMessages("displayName", {
      data,
      comment: "",
    });
    const handleMessages = buildCharacterPublicProfileGenerationMessages("handle", { data, comment: "" });

    expect(displayNameMessages[1]?.content).not.toContain("Existing display name");
    expect(displayNameMessages[1]?.content).toContain("Existing handle");
    expect(displayNameMessages[1]?.content).toContain("Generate a fresh replacement");
    expect(handleMessages[1]?.content).not.toContain("Existing handle");
    expect(handleMessages[1]?.content).toContain("Existing display name");
    expect(handleMessages[1]?.content).toContain("Generate a fresh replacement");
  });

  it("provides the current public profile target only as text to avoid on regeneration", () => {
    const data = characterData({
      name: "Mira Vale",
      extensions: {
        talkativeness: 0.5,
        fav: false,
        world: "",
        depth_prompt: {
          prompt: "",
          depth: 4,
          role: "system",
        },
        backstory: "",
        appearance: "",
        publicProfile: {
          displayName: "Mira",
          handle: "@mira",
          bio: "I keep the keys.",
        },
      },
    });

    const messages = buildCharacterPublicProfileGenerationMessages("bio", { data, comment: "" });

    expect(messages[1]?.content).not.toContain("Existing bio");
    expect(messages[1]?.content).toContain("Previous bio to replace");
    expect(messages[1]?.content).toContain("I keep the keys.");
    expect(messages[1]?.content).toContain("substantially different");
  });
});

describe("buildCharacterPublicProfileBannerPrompt", () => {
  it("asks for the banner the character would choose for themself without private notes", () => {
    const data = characterData({
      name: "Mira Vale",
      description: "A city archivist with too many keys.",
      personality: "Dry, exacting, and allergic to sentiment.",
      first_mes: "You lost again? Fine. Hand me the map.",
      mes_example: "<START>\n{{user}}: you missed me\n{{char}}: tragically, yes. don't make it weird.",
      creator_notes: "Private setup instructions and model settings.",
      system_prompt: "Secret behavior policy.",
      tags: ["archive", "keys"],
      extensions: {
        talkativeness: 0.5,
        fav: false,
        world: "",
        depth_prompt: {
          prompt: "",
          depth: 4,
          role: "system",
        },
        backstory: "",
        appearance: "dark coat, brass key ring, ink-stained gloves",
        publicProfile: {
          displayName: "Mira after dark",
          handle: "@lockbox",
          bio: "I keep the keys. You keep up.",
        },
      },
    });

    const prompt = buildCharacterPublicProfileBannerPrompt({ data, comment: "Night-shift archive keeper" });

    expect(prompt).toContain("the public profile banner this character would choose for themself");
    expect(prompt).toContain("not an outside illustration of what would fit them");
    expect(prompt).toContain("not a portrait, character sheet, or narrator scene about them");
    expect(prompt).toContain("Discord-style social banner");
    expect(prompt).toContain("Mira after dark");
    expect(prompt).toContain("I keep the keys. You keep up.");
    expect(prompt).toContain("dark coat, brass key ring, ink-stained gloves");
    expect(prompt).toContain("tragically, yes");
    expect(prompt).toContain("archive, keys");
    expect(prompt).not.toContain("Private setup");
    expect(prompt).not.toContain("Secret behavior policy");
  });
});
describe("cleanGeneratedCharacterPublicProfileField", () => {
  it("extracts JSON field values and normalizes handles", () => {
    expect(cleanGeneratedCharacterPublicProfileField("handle", '{ "handle": "Night Shift Keys" }')).toBe(
      "@night_shift_keys",
    );
    expect(cleanGeneratedCharacterPublicProfileField("displayName", '{ "displayName": "Mira, after dark" }')).toBe(
      "Mira, after dark",
    );
  });

  it("cleans plain text without preserving labels or markdown fences", () => {
    expect(cleanGeneratedCharacterPublicProfileField("bio", "```text\nBio: i keep the keys. you keep up.\n```")).toBe(
      "i keep the keys. you keep up.",
    );
  });
});
