import { describe, expect, it } from "vitest";
import {
  createDefaultImageGenerationProfile,
  normalizeImageGenerationProfile,
} from "./image-generation-defaults";

describe("image generation defaults", () => {
  it("preserves connection scoped style profile ids", () => {
    const { profile } = normalizeImageGenerationProfile(
      {
        seed: 42,
        styleProfileId: "novelai-anime",
        novelai: { promptPrefix: "best quality" },
      },
      "novelai",
    );

    expect(profile.styleProfileId).toBe("novelai-anime");
  });

  it("preserves the ComfyUI missing-reference placeholder option", () => {
    const { profile } = normalizeImageGenerationProfile(
      {
        service: "comfyui",
        comfyui: { uploadPlaceholderOnMissingReference: true },
      },
      "comfyui",
    );

    expect(profile.comfyui?.uploadPlaceholderOnMissingReference).toBe(true);
  });

  it("keeps the NovelAI reference fidelity, clamped to 0-1, and defaults it to full", () => {
    const read = (novelai: Record<string, unknown>) =>
      normalizeImageGenerationProfile({ service: "novelai", novelai }, "novelai").profile.novelai?.referenceFidelity;

    expect(read({ referenceFidelity: 0.5 })).toBe(0.5);
    expect(read({ referenceFidelity: 3 })).toBe(1);
    expect(read({})).toBe(1);
  });

  it("defaults restored image controls to disabled/null", () => {
    const profile = createDefaultImageGenerationProfile("comfyui");

    expect(profile.styleProfileId).toBeNull();
    expect(profile.comfyui?.uploadPlaceholderOnMissingReference).toBe(false);
  });
});
