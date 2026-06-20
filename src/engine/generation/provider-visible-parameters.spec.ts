import { describe, expect, it } from "vitest";
import { providerVisibleLlmParameters } from "./provider-visible-parameters";

describe("providerVisibleLlmParameters", () => {
  it("mirrors Fable adaptive Anthropic payload shaping within the provider token ceiling", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "anthropic",
        model: "claude-fable-5",
        maxTokensOverride: 4096,
      },
      {
        maxTokens: 64000,
        reasoningEffort: "xhigh",
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
      },
      { stream: true },
    );

    expect(visible).toMatchObject({
      max_tokens: 4096,
      stream: true,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });
    expect(visible).not.toHaveProperty("temperature");
    expect(visible).not.toHaveProperty("top_p");
    expect(visible).not.toHaveProperty("top_k");
  });

  it("mirrors capped Gemini 2.5 thinking budgets for small output ceilings", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "google",
        model: "gemini-2.5-flash",
      },
      {
        maxTokens: 512,
        reasoningEffort: "high",
      },
    );

    expect(visible).toMatchObject({
      generationConfig: {
        maxOutputTokens: 512,
        thinkingConfig: {
          thinkingBudget: 256,
          includeThoughts: true,
        },
      },
    });
  });
});
