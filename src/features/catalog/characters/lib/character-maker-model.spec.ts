import { describe, expect, it } from "vitest";

import { buildGeneratedCharacterPublicProfile } from "./character-maker-model";

describe("buildGeneratedCharacterPublicProfile", () => {
  it("uses explicit generated public profile fields before deriving from card fields", () => {
    const profile = buildGeneratedCharacterPublicProfile(
      {
        name: "Mira",
        description: "A private long description.",
        creator_notes: "Never show this setup note.",
        publicProfile: {
          displayName: "Mira Vale",
          handle: "@moonbard",
          bio: "A cheerful bard who remembers every song half-wrong.",
          tags: ["music", "", "Music", "sunny"],
          bannerImage: "gallery://banner-1",
        },
      },
      "Mira",
    );

    expect(profile).toEqual({
      displayName: "Mira Vale",
      handle: "@moonbard",
      bio: "A cheerful bard who remembers every song half-wrong.",
      bannerImage: "gallery://banner-1",
    });
    expect(JSON.stringify(profile)).not.toContain("Never show");
  });

  it("derives a usable public profile when maker output uses the older character shape", () => {
    const profile = buildGeneratedCharacterPublicProfile(
      {
        description: "A city archivist with too many keys.\n\nHer deeper secrets stay in the full card.",
        tags: ["archivist"],
      },
      "Mira",
    );

    expect(profile).toEqual({
      displayName: "Mira",
      bio: "A city archivist with too many keys.",
    });
  });
});
