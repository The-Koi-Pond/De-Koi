import { describe, expect, it } from "vitest";
import { isCustomizationSafeMode, normalAppUrl } from "./customization-safe-mode";

describe("customization safe mode routing", () => {
  it("recognizes only the explicit customization safe-mode value", () => {
    expect(isCustomizationSafeMode({ search: "?safe-mode=customizations" })).toBe(true);
    expect(isCustomizationSafeMode({ search: "?safe-mode=other" })).toBe(false);
    expect(isCustomizationSafeMode({ search: "" })).toBe(false);
  });

  it("builds a return URL without discarding unrelated query parameters", () => {
    expect(normalAppUrl("https://de-koi.test/app?safe-mode=customizations&tab=themes#top")).toBe(
      "/app?tab=themes#top",
    );
  });
});
