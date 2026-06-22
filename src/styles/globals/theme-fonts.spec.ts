import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function themeTokensCss(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(testDir, "02-theme-tokens.css"), "utf8");
}

function y2kFontStack(): string {
  const match = themeTokensCss().match(/--font-y2k:\s*([\s\S]*?);/);
  if (!match) throw new Error("--font-y2k token was not found");
  return match[1]!.replace(/\s+/g, " ").trim();
}

describe("theme font stacks", () => {
  it("keeps platform emoji fonts in the app text fallback stack", () => {
    const stack = y2kFontStack();
    const sansIndex = stack.indexOf("sans-serif");

    for (const family of ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"]) {
      const index = stack.indexOf(family);
      expect(index, `${family} should be present before generic sans-serif`).toBeGreaterThanOrEqual(0);
      expect(index, `${family} should be checked before generic sans-serif`).toBeLessThan(sansIndex);
    }
  });
});
