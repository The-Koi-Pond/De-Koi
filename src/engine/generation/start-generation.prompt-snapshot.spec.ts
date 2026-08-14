import { describe, expect, it } from "vitest";

import { buildSavedGenerationPromptSnapshot } from "./start-generation";

const connection = {
  id: "conn-1",
  provider: "test-provider",
  model: "test-model",
};

describe("buildSavedGenerationPromptSnapshot", () => {
  it("preserves the final context fit decision", () => {
    const contextFitDecision = {
      removedMessages: [{ contextKind: "injection", displayName: "Trackers", estimatedTokens: 320 }],
      truncatedMessages: [],
      originalEstimatedTokens: 500,
      fittedEstimatedTokens: 180,
      inputBudgetTokens: 300,
    };
    const snapshot = buildSavedGenerationPromptSnapshot({
      connection,
      promptSnapshot: {
        messages: [{ role: "user", content: "What happened?" }],
        parameters: { maxTokens: 400 },
        contextFitDecision,
      },
    });

    expect(snapshot?.contextFitDecision).toEqual(contextFitDecision);
  });

  it("preserves context attribution from the main request snapshot", () => {
    const snapshot = buildSavedGenerationPromptSnapshot({
      connection,
      promptSnapshot: {
        messages: [{ role: "system", content: "<memories>Remember the koi pond.</memories>" }],
        parameters: { temperature: 0.7 },
        promptPresetId: "preset-1",
        contextAttribution: {
          source: "saved_snapshot",
          items: [
            {
              kind: "memory_recall",
              label: "Memory 1",
              status: "injected",
              snippet: "Remember the koi pond.",
            },
          ],
        },
      },
    });

    expect(snapshot?.contextAttribution).toEqual({
      source: "saved_snapshot",
      items: [
        {
          kind: "memory_recall",
          label: "Memory 1",
          status: "injected",
          snippet: "Remember the koi pond.",
        },
      ],
    });
  });

  it("preserves the selected profile and provider-visible effective values", () => {
    const snapshot = buildSavedGenerationPromptSnapshot({
      connection,
      promptSnapshot: {
        messages: [{ role: "user", content: "Hello" }],
        parameters: { temperature: 0.7, max_tokens: 2048 },
        generationProfile: {
          profileId: "conversation-balanced",
          profileVersion: 1,
          source: "recommended",
          rationale: "Uses balanced sampling.",
          effectiveValues: { temperature: 0.7, max_tokens: 2048 },
        },
      },
    });

    expect(snapshot?.generationProfile).toEqual({
      profileId: "conversation-balanced",
      profileVersion: 1,
      source: "recommended",
      rationale: "Uses balanced sampling.",
      effectiveValues: { temperature: 0.7, max_tokens: 2048 },
    });
  });

  it("stores preview messages as request references plus only structurally distinct inline messages", () => {
    const requestMessages = [
      { role: "system" as const, content: "Merged provider prompt", images: ["data:image/png;base64,large"] },
      { role: "user" as const, content: "Continue", contextKind: "history" },
    ];
    const snapshot = buildSavedGenerationPromptSnapshot({
      connection,
      promptSnapshot: {
        messages: requestMessages,
        previewMessages: [{ role: "system", content: "Character card", contextKind: "character" }, requestMessages[1]!],
        parameters: { maxTokens: 400 },
      },
    });

    expect(snapshot?.previewMessages).toBeUndefined();
    expect(snapshot?.previewMessageRefs).toEqual([
      { message: { role: "system", content: "Character card", contextKind: "character" } },
      { messageIndex: 1 },
    ]);
  });

  it("omits preview storage entirely when the preview is identical to the request", () => {
    const messages = [{ role: "user" as const, content: "Continue", images: ["data:image/png;base64,large"] }];
    const snapshot = buildSavedGenerationPromptSnapshot({
      connection,
      promptSnapshot: { messages, previewMessages: messages, parameters: {} },
    });

    expect(snapshot?.previewMessages).toBeUndefined();
    expect(snapshot?.previewMessageRefs).toBeUndefined();
  });
});
