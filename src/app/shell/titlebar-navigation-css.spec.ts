import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles/globals/03-base-shell.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("desktop titlebar navigation CSS", () => {
  it("keeps titlebar icon controls at their compact fixed width", () => {
    const broad = rule(".mari-chat-title-controls button,\n.mari-panel-nav button");
    expect(broad).toContain("width: 1.875rem");
    expect(broad).toMatch(/padding:\s*0\s*;/);
  });

  it("keeps the Home icon control compact", () => {
    const home = rule(".mari-title-home-button");
    expect(home).toContain("width: 2.125rem");
    expect(home).toMatch(/padding:\s*0\s*;/);
  });
});
