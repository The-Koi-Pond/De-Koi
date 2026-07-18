import { describe, expect, it } from "vitest";
import { normalizeGeneratedImageResult } from "./generated-image";

describe("normalizeGeneratedImageResult", () => {
  it.each([
    ["PNG", "image/png", "png", "png"],
    ["JPEG", "image/jpeg", "jpeg", "jpg"],
    ["WebP", "image/webp", "webp", "webp"],
    ["GIF", "image/gif", "gif", "gif"],
  ])("preserves canonical %s output", (_label, mimeType, ext, expectedExt) => {
    const direct = `data:${mimeType};base64,direct`;

    expect(
      normalizeGeneratedImageResult({
        image: direct,
        base64: "fallback",
        mimeType,
        ext,
      }),
    ).toEqual({
      dataUrl: direct,
      mimeType,
      ext: expectedExt,
    });
  });

  it("constructs a data URL from legacy base64 and MIME output", () => {
    expect(
      normalizeGeneratedImageResult({
        base64: "YWJj",
        mimeType: " IMAGE/JPEG; charset=binary ",
      }),
    ).toEqual({
      dataUrl: "data:image/jpeg;base64,YWJj",
      mimeType: "image/jpeg",
      ext: "jpg",
    });
  });

  it("uses a supported legacy extension when MIME type is missing", () => {
    expect(normalizeGeneratedImageResult({ base64: "YWJj", ext: ".webp" })).toEqual({
      dataUrl: "data:image/webp;base64,YWJj",
      mimeType: "image/webp",
      ext: "webp",
    });
  });

  it("falls back to PNG for missing, malformed, or unsupported format metadata", () => {
    expect(
      normalizeGeneratedImageResult({
        base64: "YWJj",
        mimeType: "image/svg+xml",
        ext: "tool.exe",
      }),
    ).toEqual({
      dataUrl: "data:image/png;base64,YWJj",
      mimeType: "image/png",
      ext: "png",
    });
  });

  it("returns an empty data URL when neither direct image nor base64 exists", () => {
    expect(normalizeGeneratedImageResult({ mimeType: "image/gif", ext: "gif" })).toEqual({
      dataUrl: "",
      mimeType: "image/gif",
      ext: "gif",
    });
  });
});
