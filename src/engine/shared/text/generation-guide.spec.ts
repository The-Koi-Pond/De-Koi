import { describe, expect, it } from "vitest";

import { buildGenerationGuideMessages } from "./generation-guide";

describe("buildGenerationGuideMessages", () => {
  it("places Prose Guardian avoidance as an internal system guide instead of a user turn", () => {
    const messages = buildGenerationGuideMessages({
      contextInjections: [{ agentType: "prose-guardian", text: "Avoid repeating moonlit silver hair." }],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "system",
        contextKind: "injection",
        displayName: "Prose Guardian Avoidance",
        content: expect.stringContaining("prose_guardian_avoidance"),
      }),
    ]);
    expect(messages.at(-1)?.role).not.toBe("user");
  });

  it("keeps user-authored guided generation as a user guide", () => {
    const messages = buildGenerationGuideMessages({
      generationGuide: "Make the reply colder and shorter.",
      generationGuideSource: "guide",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "user",
        contextKind: "prompt",
        displayName: "Generation Guide",
        content: "Make the reply colder and shorter.",
      }),
    ]);
  });

  it("keeps user steering separate from internal avoidance when both are present", () => {
    const messages = buildGenerationGuideMessages({
      generationGuide: "Keep the same scene beat.",
      generationGuideSource: "amend",
      contextInjections: [{ agentType: "prose-guardian", text: "Avoid repeating shoulder tension." }],
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "system"]);
    expect(messages[0]).toEqual(expect.objectContaining({ displayName: "Amend Guide" }));
    expect(messages[1]).toEqual(expect.objectContaining({ displayName: "Prose Guardian Avoidance" }));
  });
});