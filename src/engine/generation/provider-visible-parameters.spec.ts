import { describe, expect, it } from "vitest";
import { providerVisibleLlmParameters } from "./provider-visible-parameters";
import { resolveRecommendedGenerationProfile } from "./recommended-generation-profile";

describe("providerVisibleLlmParameters", () => {
  it("applies provider capability filtering after resolving a recommendation", () => {
    const recommendation = resolveRecommendedGenerationProfile({
      mode: "conversation",
      provider: "anthropic",
      model: "claude-fable-5",
      capabilities: { reasoning: true },
      maxContext: 128_000,
    });

    const visible = providerVisibleLlmParameters(
      { provider: "anthropic", model: "claude-fable-5" },
      recommendation.parameters,
    );

    expect(recommendation.parameters).toMatchObject({
      temperature: 0.7,
      topP: 0.95,
      reasoningEffort: "low",
    });
    expect(visible).not.toHaveProperty("temperature");
    expect(visible).not.toHaveProperty("top_p");
    expect(visible).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "low" },
    });
  });

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

  it.each(["z-ai/glm-5.2", "glm-5.1", "glm"])(
    "strips top_k for NanoGPT GLM chat completions: %s",
    (model) => {
      const visible = providerVisibleLlmParameters(
        {
          provider: "nanogpt",
          model,
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
    },
  );

  it.each(["not-glm-model", "glm-router-test"])(
    "keeps top_k for NanoGPT models that are not GLM ids: %s",
    (model) => {
      const visible = providerVisibleLlmParameters(
        {
          provider: "nanogpt",
          model,
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
    },
  );
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
