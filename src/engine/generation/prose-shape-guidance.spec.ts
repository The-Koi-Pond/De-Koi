import { describe, expect, it } from "vitest";

import { withModeProseShapeGuidance } from "./prose-shape-guidance";

describe("withModeProseShapeGuidance", () => {
  const prompt = [
    { role: "system" as const, content: "Character and scene context." },
    { role: "assistant" as const, content: "The door opens." },
    { role: "user" as const, content: "Continue with a deliberate lyrical triplet." },
  ];

  it("routes Roleplay through its compact contrastive guide", () => {
    const messages = withModeProseShapeGuidance(prompt, "roleplay");

    expect(messages.map((message) => message.role)).toEqual(["system", "assistant", "system", "user"]);
    expect(messages[2]).toMatchObject({
      role: "system",
      contextKind: "injection",
      displayName: "Roleplay Prose Guidance",
    });
    expect(messages[2]?.content).toContain("Keep prose specific to this character and moment.");
    expect(messages[2]?.content).toContain("unless the requested voice or scene calls for them");
    expect(messages[2]?.content).toContain("plainly observable detail");
    expect(messages[2]?.content).toContain("infer a non-conflicting detail or write around it");
    expect(messages[2]?.content).toContain("Automatic: It wasn't fear. Not exactly.");
    expect(messages[2]?.content).toContain("Cleaner: She was afraid.");
    expect(messages[2]?.content).not.toMatch(/plot|beat plan|what happens next/i);
    expect(messages.filter((message) => message.displayName === "Roleplay Prose Guidance")).toHaveLength(1);
  });

  it("routes Conversation through its lighter message-shaped guide", () => {
    const messages = withModeProseShapeGuidance(prompt, "conversation");

    expect(messages.map((message) => message.role)).toEqual(["system", "assistant", "system", "user"]);
    expect(messages[2]).toMatchObject({
      role: "system",
      contextKind: "injection",
      displayName: "Conversation Prose Guidance",
    });
    expect(messages[2]?.content).toContain("Reply naturally in the established character voice.");
    expect(messages[2]?.content).toContain("Keep those shapes when they genuinely fit the character");
    expect(messages[2]?.content).toContain("Automatic: You're not angry. You're afraid of what it means.");
    expect(messages[2]?.content).toContain("Cleaner: You're afraid of what it means.");
    expect(messages[2]?.content).not.toContain("generic gestures");
    expect(messages.filter((message) => message.displayName === "Conversation Prose Guidance")).toHaveLength(1);
  });

  it("leaves Game prompts unchanged", () => {
    expect(withModeProseShapeGuidance(prompt, "game")).toEqual(prompt);
  });
});
