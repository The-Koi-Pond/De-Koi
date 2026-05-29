import { describe, expect, it } from "vitest";
import { sanitizeChatCss, sanitizeChatStyleDeclarations } from "./ChatMessage";

describe("ChatMessage style sanitization", () => {
  it("removes viewport-breaking inline style declarations", () => {
    const style = sanitizeChatStyleDeclarations(
      "color: red; position: fixed; inset: 0; z-index: 999999; width: 100vw; height: 99999px; font-weight: 700 !important",
    );

    expect(style).toContain("color: red");
    expect(style).toContain("font-weight: 700");
    expect(style).not.toContain("position");
    expect(style).not.toContain("inset");
    expect(style).not.toContain("z-index");
    expect(style).not.toContain("width");
    expect(style).not.toContain("height");
    expect(style).not.toContain("important");
  });

  it("scopes style blocks after removing layout escape hatches", () => {
    const css = sanitizeChatCss(
      "body{position:fixed!important;inset:0;width:100vw;color:red}.card{transform:translateY(-100vh);padding:1rem}",
    );

    expect(css).toContain("color: red");
    expect(css).toContain("padding: 1rem");
    expect(css).not.toContain("position");
    expect(css).not.toContain("inset");
    expect(css).not.toContain("width");
    expect(css).not.toContain("transform");
    expect(css).not.toContain("important");
  });
});
