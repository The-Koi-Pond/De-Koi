import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));

function y2kFontStack(cssPath: string): string {
  const match = readFileSync(resolve(testDir, cssPath), "utf8").match(/--font-y2k:\s*([\s\S]*?);/);
  if (!match) throw new Error(`--font-y2k token was not found in ${cssPath}`);
  return match[1]!.replace(/\s+/g, " ").trim();
}

describe("theme font stacks", () => {
  it.each([
    ["the default theme", "02-theme-tokens.css"],
    ["the Pond theme", "../themes/pond.css"],
  ])("keeps platform emoji fonts in %s's app text fallback stack", (_theme, cssPath) => {
    const stack = y2kFontStack(cssPath);
    const sansIndex = stack.indexOf("sans-serif");

    for (const family of ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"]) {
      const index = stack.indexOf(family);
      expect(index, `${family} should be present before generic sans-serif`).toBeGreaterThanOrEqual(0);
      expect(index, `${family} should be checked before generic sans-serif`).toBeLessThan(sansIndex);
    }
  });
});
