import { describe, expect, it } from "vitest";

import type { LlmMessage } from "../capabilities/llm";
import { buildPromptBudgetEstimate } from "./prompt-budget";

interface PromptMessageFixture extends LlmMessage {
  contextKind?: string;
  displayName?: string;
}

function promptMessage(message: PromptMessageFixture): LlmMessage {
  return message;
}

describe("buildPromptBudgetEstimate", () => {
  it("warns about sections removed or truncated by the final context fit", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [promptMessage({ role: "system", content: "Core", contextKind: "prompt" })],
      connection: { maxContext: 1_200 },
      parameters: { maxTokens: 400 },
      contextFitDecision: {
        removedMessages: [{ contextKind: "injection", displayName: "Trackers", estimatedTokens: 320 }],
        truncatedMessages: [{ contextKind: "summary", removedEstimatedTokens: 180 }],
        originalEstimatedTokens: 520,
        fittedEstimatedTokens: 20,
        inputBudgetTokens: 544,
      },
    });

    expect(budget.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "context_removed", sectionLabel: "Trackers", tokens: 320 }),
        expect.objectContaining({ kind: "context_truncated", tokens: 180 }),
      ]),
    );
  });

  it("warns when a high-signal character cue appears in multiple prompt context sources", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [
        promptMessage({
          role: "system",
          contextKind: "prompt",
          displayName: "Characters",
          content: [
            "<character_info>",
            "<public_profile>",
            "Bio: Mira is known for the silver bell braid she ties before every performance.",
            "</public_profile>",
            "<appearance>",
            "Mira wears a silver bell braid when she wants the room to notice her.",
            "</appearance>",
            "</character_info>",
          ].join("\n"),
        }),
        promptMessage({
          role: "system",
          contextKind: "prompt",
          displayName: "Summary and Memory",
          content: [
            "<memories>",
            "--- Memory 1 ---",
            "Mira promised the user she would keep the silver bell braid for the festival.",
            "</memories>",
          ].join("\n"),
        }),
      ],
      connection: { contextSize: 8192 },
      parameters: { maxTokens: 512 },
    });

    expect(budget.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "context_overlap",
          sectionKind: "character",
          phrase: "silver bell braid",
          sources: expect.arrayContaining(["public_profile", "appearance", "memories"]),
        }),
      ]),
    );
  });

  it("does not warn for short generic words shared across context blocks", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [
        promptMessage({
          role: "system",
          contextKind: "prompt",
          displayName: "Characters",
          content: "<personality>\nMira is warm and direct.\n</personality>",
        }),
        promptMessage({
          role: "system",
          contextKind: "prompt",
          displayName: "Past Events",
          content: "<chat_summary>\nMira and the user talked after work.\n</chat_summary>",
        }),
      ],
      connection: { contextSize: 8192 },
      parameters: { maxTokens: 512 },
    });

    expect(budget.warnings.some((warning) => warning.kind === "context_overlap")).toBe(false);
  });
});
