import { describe, expect, it } from "vitest";
import { getAvatarCropStyle } from "../../src/shared/lib/utils";

describe("getAvatarCropStyle", () => {
  it("renders legacy avatar crop offsets as percentages", () => {
    expect(getAvatarCropStyle({ zoom: 1.5, offsetX: -12, offsetY: 8 })).toEqual({
      transform: "scale(1.5) translate(-12%, 8%)",
    });
  });

  it("omits identity legacy avatar crop transforms", () => {
    expect(getAvatarCropStyle({ zoom: 1, offsetX: 0, offsetY: 0 })).toEqual({});
  });

  it("keeps full-image legacy crops contained while applying percentage offsets", () => {
    expect(getAvatarCropStyle({ zoom: 2, offsetX: 10, offsetY: -4, fullImage: true })).toEqual({
      objectFit: "contain",
      transform: "scale(2) translate(10%, -4%)",
    });
  });
});
