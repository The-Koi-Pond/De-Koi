import { describe, expect, it } from "vitest";
import { animateTextHtml } from "../components/AnimatedText";
import { formatNarration } from "./game-narration-format";

function expectSafeNarrationHtml(html: string) {
  expect(html).not.toMatch(/<script\b/i);
  expect(html).not.toMatch(/<img\b/i);
  expect(html).not.toMatch(/<svg\b/i);
  expect(html).not.toMatch(/\son\w+=/i);
  expect(html).not.toMatch(/javascript:/i);
}

describe("game narration formatting", () => {
  it("sanitizes dangerous model HTML while preserving allowed formatting and command badges", () => {
    const html = formatNarration(
      [
        'The door <img src=x onerror="alert(1)"> opens.',
        '<script>alert("bad")</script>',
        "**bold warning** and *quiet aside*.",
        '[qte: </span><svg onload="alert(2)"></svg>DODGE]',
        '[party_add: character="<img src=x onerror=alert(3)>Mira"]',
      ].join("\n"),
    );

    expectSafeNarrationHtml(html);
    expect(html).toContain("<strong>bold warning</strong>");
    expect(html).toContain("<em>quiet aside</em>");
    expect(html).toContain("QTE");
    expect(html).toContain("DODGE");
    expect(html).toContain("Party");
    expect(html).toContain("add: Mira");
    expect(html).toMatch(/<span class="[^"]*inline-flex/);
  });

  it("keeps animated narration HTML sanitized after effect wrapping", () => {
    const formatted = formatNarration(
      [
        '**CRITICAL** arcane fire erupts.',
        '{glow:<img src=x onerror="alert(1)">magic}',
        '[dice: 1d20+2 = 22]',
        '<a href="javascript:alert(4)">unsafe link</a>',
      ].join("\n"),
      false,
    );
    const animated = animateTextHtml(formatted);

    expectSafeNarrationHtml(animated);
    expect(animated).toContain("<strong>");
    expect(animated).toContain("anim-text-shout");
    expect(animated).toContain("anim-text-glow");
    expect(animated).toContain("inline-flex");
    expect(animated).toContain("1d20+2");
    expect(animated).toContain("unsafe link");
  });
});
