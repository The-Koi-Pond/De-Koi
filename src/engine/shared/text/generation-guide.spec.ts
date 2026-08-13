import { describe, expect, it } from "vitest";

import { buildGenerationGuideMessages } from "./generation-guide";

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
