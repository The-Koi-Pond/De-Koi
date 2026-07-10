import { describe, expect, it } from "vitest";

import { promptSnapshotToPeekPromptData } from "./use-chat-timeline-actions";

describe("promptSnapshotToPeekPromptData", () => {
  it("preserves metric-only fit decisions when no context sections were removed", () => {
    const result = promptSnapshotToPeekPromptData({
      messages: [{ role: "user", content: "Continue", contextKind: "history" }],
      parameters: { maxTokens: 256 },
      contextFitDecision: {
        removedMessages: [],
        truncatedMessages: [],
        originalEstimatedTokens: 40,
        fittedEstimatedTokens: 40,
        inputBudgetTokens: 720,
      },
    });

    expect(result?.budget?.inputBudgetTokens).toBe(720);
    expect(result?.budget?.remainingTokens).toBe(720 - result!.budget!.estimatedPromptTokens);
  });

  it("preserves fitted context kinds and surfaces saved fit warnings for cached prompts", () => {
    const result = promptSnapshotToPeekPromptData({
      messages: [
        { role: "system", content: "Core", contextKind: "prompt" },
        { role: "system", content: "Remember the lantern.", contextKind: "canonical_memory" },
        { role: "user", content: "Continue", contextKind: "history" },
      ],
      parameters: { maxTokens: 400 },
      contextFitDecision: {
        removedMessages: [{ contextKind: "lorebook", displayName: "Festival Lore", estimatedTokens: 320 }],
        truncatedMessages: [{ contextKind: "summary", removedEstimatedTokens: 180 }],
        originalEstimatedTokens: 900,
        fittedEstimatedTokens: 120,
        inputBudgetTokens: 500,
      },
    });

    expect(result?.messages[1]?.contextKind).toBe("canonical_memory");
    expect(result?.budget?.estimatedPromptTokens).toBeGreaterThan(0);
    expect(result?.budget?.inputBudgetTokens).toBe(500);
    expect(result?.budget?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context_removed", sectionLabel: "Festival Lore" }),
        expect.objectContaining({ kind: "context_truncated" }),
      ]),
    );
  });

  it("preserves standalone saved character-depth context and budgets it as character context", () => {
    const result = promptSnapshotToPeekPromptData({
      messages: [
        {
          role: "system",
          content: "Stay faithful to Mira's established voice.",
          contextKind: "character",
          displayName: "Mira Instructions",
        },
        { role: "user", content: "Continue", contextKind: "history" },
      ],
      parameters: { maxTokens: 400 },
    });

    expect(result?.messages[0]?.contextKind).toBe("character");
    expect(result?.budget?.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "character", label: "Character Context" })]),
    );
  });
});
