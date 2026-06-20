import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_PROMPTS } from "./agent-prompts";

describe("default agent prompts", () => {
  it("anchors sprite expression selection to the latest turn source", () => {
    const prompt = DEFAULT_AGENT_PROMPTS.expression;

    expect(prompt).toContain("Analyze the latest turn");
    expect(prompt).toContain("Include exactly one expression entry for every sprite owner listed");
    expect(prompt).toContain("Use <latest_user_message> to choose the active user persona's expression");
    expect(prompt).toContain("Use <assistant_response> to choose assistant or character expressions");
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
