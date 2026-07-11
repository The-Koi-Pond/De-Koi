import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readGlobalStyle = (name: string) => readFileSync(resolve(process.cwd(), "src/styles/globals", name), "utf8");

describe("shared UI readability foundations", () => {
  it("defines readable text and desktop control target contracts", () => {
    const css = readGlobalStyle("04-surfaces-components.css");

    expect(css).toMatch(/\.de-koi-caption\s*{[^}]*font-size:\s*0\.75rem/s);
    expect(css).toMatch(/\.de-koi-label\s*{[^}]*font-size:\s*0\.8125rem/s);
    expect(css).toMatch(/\.de-koi-icon-target\s*{[^}]*min-width:\s*2rem[^}]*min-height:\s*2rem/s);
    expect(css).toMatch(/\.de-koi-control-target\s*{[^}]*min-height:\s*2\.25rem/s);
  });

  it("raises shared interaction targets to 44px for coarse pointers", () => {
    const css = readGlobalStyle("07-responsive-accessibility.css");

    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\)[\s\S]*:is\(\.de-koi-icon-target,\s*\.de-koi-control-target\)[^{]*{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/s,
    );
  });
});
