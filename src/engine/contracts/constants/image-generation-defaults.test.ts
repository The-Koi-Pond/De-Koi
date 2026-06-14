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

  it("defaults restored image controls to disabled/null", () => {
    const profile = createDefaultImageGenerationProfile("comfyui");

    expect(profile.styleProfileId).toBeNull();
    expect(profile.comfyui?.uploadPlaceholderOnMissingReference).toBe(false);
  });
});
