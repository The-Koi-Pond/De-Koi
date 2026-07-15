import { describe, expect, it } from "vitest";
import { isInjectableExtensionCss, isInjectableThemeCss } from "./customization-content";

describe("customization CSS content", () => {
  it.each([null, undefined, "", "   ", { css: "body {}" }])("rejects missing or malformed theme CSS: %s", (css) => {
    expect(isInjectableThemeCss(css)).toBe(false);
  });

  it("rejects theme CSS over the byte limit", () => {
    expect(isInjectableThemeCss("x".repeat(256 * 1024 + 1))).toBe(false);
  });

  it.each([null, undefined, "", "   ", ["body {}"]])("rejects missing or malformed extension CSS: %s", (css) => {
    expect(isInjectableExtensionCss(css)).toBe(false);
  });

  it("accepts bounded theme and extension CSS", () => {
    expect(isInjectableThemeCss(":root { --primary: teal; }")).toBe(true);
    expect(isInjectableExtensionCss(".pond { color: teal; }")).toBe(true);
  });
});
