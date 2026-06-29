import { describe, expect, it } from "vitest";

import { resolveCharacterPublicProfile } from "./character-public-profile";

describe("resolveCharacterPublicProfile", () => {
  it("uses saved public profile fields before derived character-card fields", () => {
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
      tags: ["quiet", "keys"],
      bannerImage: "gallery://banner-1",
      hasSavedProfile: true,
    });
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
  it("does not use raw character descriptions as unsaved public bios", () => {
    const profile = resolveCharacterPublicProfile({
      id: "char-3",
      data: {
        name: "The Ghost Face",
        description: "Danny Johnson, known to some as Jed Olsen, is The Ghost Face: a methodical killer.",
        tags: ["dbd", "slasher"],
        extensions: {},
      },
      comment: "Freelance journalist with a taste for fear",
    });

    expect(profile.bio).toBe("Freelance journalist with a taste for fear");
    expect(profile.bio).not.toContain("Danny Johnson");
  });
});
