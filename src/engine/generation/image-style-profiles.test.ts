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

  it("normalizes default profile ids with the same slugging as custom profile ids", () => {
    const settings = normalizeImageStyleProfileSettings({
      defaultProfileId: "custom ink!",
      profiles: [
        {
          id: "custom ink!",
          name: "Ink",
          baseStyle: "custom",
          promptMode: "tagged",
          positiveTags: "ink wash",
        },
      ],
    });

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

  it("preserves required portrait details when compact profile tags exceed the soft budget", () => {
    const settings = createDefaultImageStyleProfileSettings();
    const compiled = compileImagePrompt({
      kind: "portrait",
      prompt:
        "Portrait of Mira. Appearance: statuesque, silver hair, amber eyes, sharp cheekbones, black blazer, burgundy blouse, slim trousers, heeled boots, reading glasses, statement ring, dark red nails.",
      generatedStyle:
        "Visual direction: adult woman with moonlit rim lighting, readable silhouette, clear face, confident expression, and polished anime character art.",
      userPositive:
        "scar across left cheek, freckles, bronze armor, crystal sword, wide hat, velvet gloves, embroidered collar",
      styleProfileId: "danbooru",
      styleProfiles: settings,
    });

    expect(compiled.prompt).toContain("dark red nails");
    expect(compiled.prompt).toContain("statement ring");
    expect(compiled.prompt).toContain("crystal sword");
    expect(compiled.prompt).toContain("velvet gloves");
    expect(compiled.prompt).toContain("embroidered collar");
    expect(compiled.prompt).toContain("1girl");
    expect(compiled.prompt).toContain("upper body");
    expect(compiled.prompt).not.toContain("masterpiece");
  });

  it("filters non-visual generated prose while preserving literal user positives", () => {
    const settings = createDefaultImageStyleProfileSettings();
    const compiled = compileImagePrompt({
      kind: "selfie",
      prompt: "Selfie of Mira with silver hair and amber eyes.",
      generatedStyle:
        "Mira survived academy debt, opened a business district agency, and dreams of tracking uncertain political terms.",
      userPositive: "velvet gloves, embroidered collar",
      styleProfileId: "danbooru",
      styleProfiles: settings,
    });

    expect(compiled.prompt).toContain("velvet gloves");
    expect(compiled.prompt).toContain("embroidered collar");
    expect(compiled.prompt).not.toContain("academy debt");
    expect(compiled.prompt).not.toContain("business district agency");
  });
});
