import { describe, expect, it } from "vitest";

import {
  appendReadableAttachmentsToContent,
  generationParameterSources,
  mergeStoredGenerationParameters,
} from "./generate-route-utils";

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

describe("generationParameterSources", () => {
  it("applies maintained Nano defaults after inherited connection and preset defaults", () => {
    const parameters = mergeStoredGenerationParameters(
      ...generationParameterSources(
        {
          provider: "nanogpt",
          model: "zai-org/glm-5.2",
          maxContext: 128_000,
          defaultParameters: { topP: 1, maxTokens: 8192, reasoningEffort: "maximum", verbosity: "high" },
        },
        {},
        { mode: "roleplay", metadata: {} },
        { topP: 1, maxTokens: 4096, reasoningEffort: "low", verbosity: "high" },
      ),
    );

    expect(parameters).toMatchObject({ temperature: 1, topP: 0.95, maxTokens: 2048 });
    expect(parameters).not.toHaveProperty("reasoningEffort");
    expect(parameters).not.toHaveProperty("verbosity");
  });

  it("keeps explicit chat and request parameters authoritative over maintained defaults", () => {
    const parameters = mergeStoredGenerationParameters(
      ...generationParameterSources(
        {
          provider: "nanogpt",
          model: "zai-org/glm-5.2",
          maxContext: 128_000,
          defaultParameters: { topP: 1, maxTokens: 8192, reasoningEffort: "low" },
        },
        { parameters: { topP: 0.8, reasoningEffort: "maximum" } },
        { mode: "roleplay", metadata: { chatParameters: { maxTokens: 3072 } } },
        { topP: 1, maxTokens: 4096, reasoningEffort: "low" },
      ),
    );

    expect(parameters).toMatchObject({ topP: 0.8, maxTokens: 3072, reasoningEffort: "maximum" });
  });

  it("removes suppressed aliases from inherited raw provider parameters", () => {
    const parameters = mergeStoredGenerationParameters(
      ...generationParameterSources(
        {
          provider: "custom",
          model: "[SP]claude-opus-4-7",
          baseUrl: "https://linkapi.ai/v1",
          defaultParameters: {
            customParameters: {
              temperature: 0.6,
              top_p: 0.8,
              reasoning_effort: "high",
              reasoning: { effort: "high" },
              verbosity: "high",
              retained: "connection",
            },
          },
        },
        {},
        { mode: "roleplay", metadata: {} },
        {
          custom_params: {
            thinking: { type: "enabled", budget_tokens: 4096 },
            topP: 0.7,
            retained_alias: "preset",
          },
        },
      ),
    );

    expect(parameters?.customParameters).toEqual({ retained: "connection" });
    expect(parameters?.custom_params).toEqual({ retained_alias: "preset" });
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
