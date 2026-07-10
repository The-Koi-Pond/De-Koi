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
});
