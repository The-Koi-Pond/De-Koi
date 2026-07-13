import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("Game tutorial launch policy", () => {
  it("keeps the tutorial manual-only", () => {
    const source = readFileSync(join(currentDir, "GameSurface.tsx"), "utf8");

    expect(source).not.toContain("tutorialAutoTriggeredRef");
    expect(source).not.toContain("setGameTutorialDisabled");
    expect(source).not.toMatch(/setTimeout\(\(\) => setTutorialOpen\(true\)/);
    expect(source).toContain('title="Game Mode Tutorial"');
  });
});
