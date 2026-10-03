import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readStyles(file: string) {
  return readFileSync(join(currentDir, "../styles/globals", file), "utf8");
}

describe("app reduced-motion policy", () => {
  it("turns every CSS animation and transition off when the user asks for reduced motion", () => {
    const css = readStyles("07-responsive-accessibility.css");
    const rule = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(rule).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(rule).toContain("animation-duration: 0.01ms !important;");
    expect(rule).toContain("transition-duration: 0.01ms !important;");
  });

  it("animates with CSS classes, which that rule covers, rather than a JavaScript motion library", () => {
    const motionCss = readStyles("05-effects-utilities.css");

    expect(motionCss).toContain(".motion-enter {");
    expect(motionCss).toContain(".motion-exit {");
    expect(readFileSync(join(currentDir, "AppExperience.tsx"), "utf8")).not.toContain("framer-motion");
  });
});
