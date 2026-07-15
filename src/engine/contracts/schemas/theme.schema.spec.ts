import { describe, expect, it } from "vitest";
import { createThemeSchema, updateThemeSchema } from "./theme.schema";

const MAX_THEME_CSS_BYTES = 256 * 1024;

describe("theme CSS limits", () => {
  it("rejects oversized CSS when themes are created or updated", () => {
    const oversizedCss = "x".repeat(MAX_THEME_CSS_BYTES + 1);

    expect(createThemeSchema.safeParse({ name: "Too large", css: oversizedCss }).success).toBe(false);
    expect(updateThemeSchema.safeParse({ css: oversizedCss }).success).toBe(false);
  });

  it("accepts CSS at the byte limit", () => {
    const boundedCss = "x".repeat(MAX_THEME_CSS_BYTES);

    expect(createThemeSchema.safeParse({ name: "Bounded", css: boundedCss }).success).toBe(true);
    expect(updateThemeSchema.safeParse({ css: boundedCss }).success).toBe(true);
  });

  it("counts UTF-8 bytes instead of JavaScript characters", () => {
    const multibyteCss = "😀".repeat(MAX_THEME_CSS_BYTES / 4 + 1);

    expect(createThemeSchema.safeParse({ name: "Multibyte", css: multibyteCss }).success).toBe(false);
  });
});
