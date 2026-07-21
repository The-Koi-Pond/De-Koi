import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readMainSource() {
  return readFileSync(join(currentDir, "main.tsx"), "utf8");
}

describe("app reduced-motion policy", () => {
  it("configures Framer Motion to respect the user preference at the root", () => {
    const source = readMainSource();

    expect(source).toMatch(/<MotionConfig\s+reducedMotion="user">/);
  });
});
