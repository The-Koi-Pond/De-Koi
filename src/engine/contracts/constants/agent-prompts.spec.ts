import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_PROMPTS } from "./agent-prompts";

describe("default agent prompts", () => {
  it("anchors sprite expression selection to the latest assistant message", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.expression;

    expect(prompt).toContain("Treat the latest assistant message as the authority");
    expect(prompt).toContain("do not choose the user's persona just because they exist in context");
  });

  it("keeps Illustrator prompts anchored to the latest scene and text-free images", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.illustrator;

    expect(prompt).toContain("provided in <assistant_response>");
    expect(prompt).toContain("do not illustrate an older scene");
    expect(prompt).toContain("hair length, hair style, hair color");
    expect(prompt).toContain("Do not request dialogue text");
    expect(prompt).toContain("speech bubbles");
  });
});
