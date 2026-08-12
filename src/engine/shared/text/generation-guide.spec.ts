import { describe, expect, it } from "vitest";

import { buildGenerationGuideMessages, withRoleplayProseShapeGuidance } from "./generation-guide";

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

  it("keeps explicit internal guides separate from user steering", () => {
    const messages = buildGenerationGuideMessages({
      generationGuide: "Keep the same scene beat.",
      generationGuideSource: "amend",
      internalGuides: ["[Internal formatting constraint]"],
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "system"]);
    expect(messages[0]).toEqual(expect.objectContaining({ displayName: "Amend Guide" }));
    expect(messages[1]).toEqual(
      expect.objectContaining({
        displayName: "Internal Avoidance Guidance",
        content: "[Internal formatting constraint]",
      }),
    );
  });
});

describe("withRoleplayProseShapeGuidance", () => {
  const prompt = [
    { role: "system" as const, content: "Character and scene context." },
    { role: "assistant" as const, content: "The door opens." },
    { role: "user" as const, content: "Continue with a deliberate lyrical triplet." },
  ];

  it("inserts the compact contrastive guide immediately before the final Roleplay user message", () => {
    const messages = withRoleplayProseShapeGuidance(prompt, "roleplay");

    expect(messages.map((message) => message.role)).toEqual(["system", "assistant", "system", "user"]);
    expect(messages[2]).toMatchObject({
      role: "system",
      contextKind: "injection",
      displayName: "Roleplay Prose Guidance",
    });
    expect(messages[2]?.content).toContain("Keep prose specific to this character and moment.");
    expect(messages[2]?.content).toContain("unless the requested voice or scene calls for them");
    expect(messages[2]?.content).toContain("Automatic: It wasn't fear. Not exactly.");
    expect(messages[2]?.content).toContain("Cleaner: She was afraid.");
    expect(messages[2]?.content).not.toMatch(/plot|beat plan|what happens next/i);
    expect(messages.filter((message) => message.displayName === "Roleplay Prose Guidance")).toHaveLength(1);
  });

  it("does not add prose-shape guidance outside Roleplay", () => {
    expect(withRoleplayProseShapeGuidance(prompt, "conversation")).toEqual(prompt);
    expect(withRoleplayProseShapeGuidance(prompt, "game")).toEqual(prompt);
  });
});
