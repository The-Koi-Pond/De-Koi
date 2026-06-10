import { describe, expect, it } from "vitest";
import { createDefaultImageStyleProfileSettings } from "../../../../engine/generation/image-style-profiles";
import { compiledSceneAssetNegativePrompt, sceneAssetPrompt } from "./game-asset-prompts";

describe("game image asset prompts", () => {
  it("uses the selected style profile for prompt and negative prompt output", () => {
    const styleProfiles = createDefaultImageStyleProfileSettings();
    const settings = {
      includeAppearances: true,
      format: "tags" as const,
      styleProfileId: "danbooru",
      styleProfiles,
    };

    const prompt = sceneAssetPrompt("portrait", "Mira", "silver hair and violet eyes", "cinematic lighting", settings);
    const negativePrompt = compiledSceneAssetNegativePrompt("portrait", settings);

    expect(prompt).toContain("1girl");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("masterpiece");
    expect(negativePrompt).toContain("worst quality");
    expect(negativePrompt).toContain("bad anatomy");
  });
});
