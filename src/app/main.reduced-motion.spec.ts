import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readMainSource() {
  return readFileSync(join(currentDir, "main.tsx"), "utf8");
}

function readAppExperienceSource() {
  return readFileSync(join(currentDir, "AppExperience.tsx"), "utf8");
}

describe("app reduced-motion policy", () => {
  it("keeps Framer Motion behind the lazy app experience while respecting the user preference", () => {
    const mainSource = readMainSource();
    const appExperienceSource = readAppExperienceSource();

    expect(mainSource).not.toContain('from "framer-motion"');
    expect(appExperienceSource).toContain('import { MotionConfig } from "framer-motion"');
    expect(appExperienceSource).toMatch(/<MotionConfig\s+reducedMotion="user">/);
  });
});
