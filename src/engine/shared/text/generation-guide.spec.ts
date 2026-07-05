import { describe, expect, it } from "vitest";
import { buildGenerationGuideMessages, buildProseGuardianAvoidanceGuide } from "./generation-guide";

describe("buildGenerationGuideMessages", () => {
  it("keeps user-authored steering in a user prompt message", () => {
    const messages = buildGenerationGuideMessages({
      userGuide: "[Guided generation instruction: make the reply shorter]",
      internalGuides: [],
    });

    expect(messages).toEqual([
      {
        role: "user",
        content: "[Guided generation instruction: make the reply shorter]",
        contextKind: "prompt",
        displayName: "Generation Guide",
      },
    ]);
  });

  it("places internal avoidance guidance in system injection context", () => {
    const proseGuardianGuide = buildProseGuardianAvoidanceGuide([
      { agentType: "prose-guardian", text: "Avoid repeating moonlit smile." },
    ]);
    const messages = buildGenerationGuideMessages({
      userGuide: "[Guided generation instruction: keep going]",
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
  });
});