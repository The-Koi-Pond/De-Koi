import { describe, expect, it } from "vitest";
import { generationInfoFromVisibleParameters, providerVisibleLlmParameters } from "./provider-visible-parameters";

describe("providerVisibleLlmParameters", () => {
  it("shows only Anthropic Opus adaptive-thinking parameters that reach the provider", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "anthropic", model: "claude-opus-4-8" },
      {
        maxTokens: 4096,
        temperature: 0.7,
        topK: 20,
        topP: 0.9,
        reasoningEffort: "xhigh",
        verbosity: "high",
        showThoughts: true,
      },
      { stream: true },
    );

    expect(visible).toEqual({
      max_tokens: 4096,
      stream: true,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });

    const info = generationInfoFromVisibleParameters({ provider: "anthropic", model: "claude-opus-4-8" }, visible);
    expect(info.temperature).toBeNull();
    expect(info.topK).toBeNull();
    expect(info.verbosity).toBeNull();
    expect(info.reasoningEffort).toBe("xhigh");
    expect(info.showThoughts).toBe(true);
  });

  it("requests Anthropic summarized thinking by default for adaptive models", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "anthropic", model: "claude-opus-4-8" },
      {
        maxTokens: 4096,
        reasoningEffort: "xhigh",
      },
      { stream: true },
    );

    expect(visible).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });

    const info = generationInfoFromVisibleParameters({ provider: "anthropic", model: "claude-opus-4-8" }, visible);
    expect(info.showThoughts).toBe(true);
  });

  it("maps Anthropic maximum effort to the provider max level", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "anthropic", model: "claude-opus-4-8" },
      {
        maxTokens: 4096,
        reasoningEffort: "maximum",
      },
      { stream: true },
    );

    expect(visible).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "max" },
    });

    const info = generationInfoFromVisibleParameters({ provider: "anthropic", model: "claude-opus-4-8" }, visible);
    expect(info.reasoningEffort).toBe("max");
  });

  it("always requests Anthropic summarized thinking display for adaptive models", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "anthropic", model: "claude-opus-4-8" },
      {
        maxTokens: 4096,
        reasoningEffort: "xhigh",
        showThoughts: false,
      },
      { stream: true },
    );

    expect(visible).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });

    const info = generationInfoFromVisibleParameters({ provider: "anthropic", model: "claude-opus-4-8" }, visible);
    expect(info.showThoughts).toBe(true);
  });

  it("strips OpenRouter Claude Opus sampling parameters from the peekable request shape", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "openrouter", model: "anthropic/claude-opus-4-8", openrouterProvider: "anthropic" },
      {
        maxTokens: 8192,
        temperature: 0.3,
        topP: 0.9,
        topK: 40,
        reasoningEffort: "xhigh",
        customParameters: { temperature: 0.2, presence_penalty: 0.5, safe_prompt: true },
      },
      { stream: true },
    );

    expect(visible).toMatchObject({
      stream: true,
      max_tokens: 8192,
      reasoning: { effort: "high" },
      provider: { order: ["anthropic"] },
      safe_prompt: true,
    });
    expect(visible).not.toHaveProperty("temperature");
    expect(visible).not.toHaveProperty("top_p");
    expect(visible).not.toHaveProperty("top_k");
    expect(visible).not.toHaveProperty("presence_penalty");
  });

  it("shows Gemini 3 generation config without sampler parameters", () => {
    const visible = providerVisibleLlmParameters(
      { provider: "google", model: "gemini-3.5-flash" },
      {
        maxTokens: 2048,
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        reasoningEffort: "high",
      },
      { stream: true },
    );

    expect(visible).toEqual({
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
      },
    });

    const info = generationInfoFromVisibleParameters({ provider: "google", model: "gemini-3.5-flash" }, visible);
    expect(info.maxTokens).toBe(2048);
    expect(info.temperature).toBeNull();
    expect(info.topP).toBeNull();
    expect(info.topK).toBeNull();
    expect(info.reasoningEffort).toBe("high");
  });
});
