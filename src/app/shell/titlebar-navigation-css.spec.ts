import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles/globals/03-base-shell.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("desktop titlebar navigation CSS", () => {
  it("does not force broad labeled controls into icon-only fixed widths", () => {
    const broad = rule(".mari-chat-title-controls button,\n.mari-panel-nav button");
    expect(broad).toContain("min-width: 1.875rem");
    expect(broad).toContain("width: auto");
    expect(broad).not.toMatch(/padding:\s*0\s*;/);
  });

  it("keeps the labeled Home control auto-sized without erasing component padding", () => {
    const home = rule(".mari-title-home-button");
    expect(home).toContain("min-width: 2.125rem");
    expect(home).toContain("width: auto");
    expect(home).not.toMatch(/padding:\s*0\s*;/);
  });
});
