import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles/globals/08-game-cinematic-effects.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("Deki compact hero CSS", () => {
  it("reduces desktop hero height and pond width after persisted history", () => {
    expect(rule('.deki-hero[data-state="compact"]')).toMatch(/min-height:\s*clamp\([^)]*,\s*[^,]*,\s*9rem\)/);
    expect(rule('.deki-hero[data-state="compact"] .deki-pond-scene')).toContain("14rem");
  });

  it("reduces mobile hero height and pond width after persisted history", () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.deki-hero\[data-state="compact"\]\s*\{[^}]*min-height:\s*clamp\([^)]*,\s*[^,]*,\s*7rem\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.deki-hero\[data-state="compact"\] \.deki-pond-scene\s*\{[^}]*12rem/,
    );
  });
});
