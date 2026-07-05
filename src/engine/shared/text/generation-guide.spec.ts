import { describe, expect, it } from "vitest";

import { buildGenerationGuideMessages, buildProseGuardianAvoidanceGuide } from "./generation-guide";

describe("buildGenerationGuideMessages", () => {
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

  it("labels amend steering separately from internal avoidance", () => {
    const messages = buildGenerationGuideMessages({
      generationGuide: "Keep the same scene beat.",
      generationGuideSource: "amend",
      contextInjections: [{ agentType: "prose-guardian", text: "Avoid repeating shoulder tension." }],
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "system"]);
    expect(messages[0]).toEqual(expect.objectContaining({ displayName: "Amend Guide" }));
    expect(messages[1]).toEqual(expect.objectContaining({ displayName: "Internal Avoidance Guidance" }));
    expect(messages[1]?.content).toContain("prose_guardian_avoidance");
  });

  it("combines explicit internal guides with Prose Guardian avoidance as system injection", () => {
    const proseGuardianGuide = buildProseGuardianAvoidanceGuide([
      { agentType: "prose-guardian", text: "Avoid repeating moonlit smile." },
    ]);
    const messages = buildGenerationGuideMessages({
      generationGuide: "Keep going.",
      generationGuideSource: "guide",
      internalGuides: [proseGuardianGuide, "[Conversation freshness guide]"],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", contextKind: "prompt", displayName: "Generation Guide" });
    expect(messages[1]).toMatchObject({
      role: "system",
      contextKind: "injection",
      displayName: "Internal Avoidance Guidance",
    });
    expect(messages[1]?.content).toContain("Prose Guardian avoidance instruction");
    expect(messages[1]?.content).toContain("Conversation freshness guide");
    expect(messages.at(-1)?.role).not.toBe("user");
  });
});