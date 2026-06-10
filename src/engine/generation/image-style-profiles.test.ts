import { describe, expect, it } from "vitest";
import {
  compileImagePrompt,
  createDefaultImageStyleProfileSettings,
  normalizeImageStyleProfileSettings,
} from "./image-style-profiles";

describe("image style profiles", () => {
  it("applies selected profile subject tags and negative tags", () => {
    const settings = createDefaultImageStyleProfileSettings();
    const compiled = compileImagePrompt({
      kind: "portrait",
      prompt: "Portrait of Mira with silver hair, cinematic lighting",
      negativePrompt: "text, blurry",
      styleProfileId: "danbooru",
      styleProfiles: settings,
    });

    expect(compiled.profile.id).toBe("danbooru");
    expect(compiled.prompt).toContain("1girl");
    expect(compiled.prompt).toContain("silver hair");
    expect(compiled.prompt).toContain("masterpiece");
    expect(compiled.negativePrompt).toContain("worst quality");
    expect(compiled.diagnostics.removedNegativeDuplicates).toContain("text");
  });

  it("normalizes custom profiles while preserving built-ins", () => {
    const settings = normalizeImageStyleProfileSettings({
      defaultProfileId: "custom-ink",
      profiles: [
        {
          id: "custom ink!",
          name: "Ink",
          baseStyle: "custom",
          promptMode: "tagged",
          positiveTags: "ink wash",
          negativeTags: "flat lighting",
          subjectTags: { background: "misty scenery" },
          rules: { dedupeStrength: "strict", preferTagsOverNarrative: true, preserveUserPhrases: true },
        },
      ],
    });

    expect(settings.profiles.some((profile) => profile.id === "auto")).toBe(true);
    expect(settings.profiles.some((profile) => profile.id === "custom-ink")).toBe(true);
    expect(settings.defaultProfileId).toBe("custom-ink");
  });

  it("moves obvious negative fragments out of positive prompts", () => {
    const settings = createDefaultImageStyleProfileSettings();
    const compiled = compileImagePrompt({
      kind: "illustration",
      prompt: "Cinematic scene, avoid watermark, no text",
      styleProfileId: "cinematic",
      styleProfiles: settings,
    });

    expect(compiled.prompt).not.toContain("avoid watermark");
    expect(compiled.negativePrompt).toContain("watermark");
    expect(compiled.negativePrompt).toContain("text");
    expect(compiled.diagnostics.movedNegativeFragments).toEqual(expect.arrayContaining(["avoid watermark", "no text"]));
  });
});
