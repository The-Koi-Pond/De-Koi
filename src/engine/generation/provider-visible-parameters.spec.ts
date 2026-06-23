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

  it("mirrors Mythos adaptive Anthropic payload shaping and strips sampling", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "anthropic",
        model: "claude-mythos-5",
      },
      {
        maxTokens: 64000,
        reasoningEffort: "xhigh",
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
      },
    );

    expect(visible).toMatchObject({
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });
    expect(visible).not.toHaveProperty("temperature");
    expect(visible).not.toHaveProperty("top_p");
    expect(visible).not.toHaveProperty("top_k");
  });

  it("strips sampling for Mythos behind OpenAI-compatible providers", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "openrouter",
        model: "anthropic/claude-mythos-5",
      },
      {
        maxTokens: 4096,
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        frequencyPenalty: 0.2,
      },
    );

    expect(visible).toMatchObject({ max_tokens: 4096 });
    expect(visible).not.toHaveProperty("temperature");
    expect(visible).not.toHaveProperty("top_p");
    expect(visible).not.toHaveProperty("top_k");
    expect(visible).not.toHaveProperty("frequency_penalty");
  });

  it("strips top_k for NanoGPT GLM chat completions", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "nanogpt",
        model: "glm-5.2",
      },
      {
        maxTokens: 4096,
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        customParameters: { top_k: 99 },
      },
    );

    expect(visible).toMatchObject({
      max_tokens: 4096,
      temperature: 0.8,
      top_p: 0.9,
    });
    expect(visible).not.toHaveProperty("top_k");
  });

  it("keeps top_k for NanoGPT models that are not GLM ids", () => {
    const visible = providerVisibleLlmParameters(
      {
        provider: "nanogpt",
        model: "not-glm-model",
      },
      {
        maxTokens: 4096,
        topK: 40,
      },
    );

    expect(visible).toMatchObject({
      max_tokens: 4096,
      top_k: 40,
    });
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
