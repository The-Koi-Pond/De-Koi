import { describe, expect, it } from "vitest";

import { appendReadableAttachmentsToContent, mergeStoredGenerationParameters } from "./generate-route-utils";

function textDataUrl(value: string): string {
  return "data:application/json;base64," + btoa(value);
}

describe("mergeStoredGenerationParameters", () => {
  it("preserves custom thinking tag generation parameters", () => {
    expect(
      mergeStoredGenerationParameters({
        temperature: 0.7,
        customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }],
      }),
    ).toMatchObject({
      temperature: 0.7,
      customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }],
    });
  });

  it("lets later custom thinking tag sources override inherited pairs", () => {
    expect(
      mergeStoredGenerationParameters(
        { customThinkingTags: [{ open: "<analysis>", close: "</analysis>" }] },
        { customThinkingTags: [{ open: "<scratchpad>", close: "</scratchpad>" }] },
      ),
    ).toMatchObject({
      customThinkingTags: [{ open: "<scratchpad>", close: "</scratchpad>" }],
    });
  });
});

describe("appendReadableAttachmentsToContent", () => {
  it("redacts inline image data URLs from JSON attachments before adding them to prompt text", () => {
    const cardJson = JSON.stringify(
      {
        data: {
          name: "Mina",
          description: "A careful observer.",
          avatar: "data:image/png;base64,AAAAABBBBBCCCCCDDDDDEEEEE",
        },
      },
      null,
      2,
    );

    const content = appendReadableAttachmentsToContent("Could I get your thoughts on this character card?", [
      {
        type: "application/json",
        data: textDataUrl(cardJson),
        filename: "character.dekoi.json",
        name: "character.dekoi.json",
      },
    ]);

    expect(content).toContain("<attached_file");
    expect(content).toContain("\x22name\x22: \x22Mina\x22");
    expect(content).toContain("\x22description\x22: \x22A careful observer.\x22");
    expect(content).toContain("[redacted inline image data URL");
    expect(content).not.toContain("AAAAABBBBBCCCCCDDDDDEEEEE");
  });
});
