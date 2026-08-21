import { describe, expect, it } from "vitest";
import {
  applyRecommendedPromptBudgetGuidance,
  resolveRecommendedGenerationProfile,
} from "./recommended-generation-profile";

describe("resolveRecommendedGenerationProfile", () => {
  it.each([
    {
      name: "balanced conversation on a reasoning model",
      input: {
        mode: "conversation" as const,
        provider: "openai",
        model: "gpt-5.2",
        capabilities: { reasoning: true },
        maxContext: 128_000,
        executionTarget: "embedded" as const,
      },
      expected: {
        profileId: "conversation-balanced",
        source: "recommended",
        parameters: { temperature: 0.7, maxTokens: 2048, reasoningEffort: "low", verbosity: "medium" },
      },
    },
    {
      name: "expressive roleplay",
      input: {
        mode: "roleplay" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        capabilities: { reasoning: true },
        maxContext: 200_000,
        executionTarget: "embedded" as const,
      },
      expected: {
        profileId: "roleplay-expressive",
        source: "recommended",
        parameters: { temperature: 1, maxTokens: 4096, reasoningEffort: "low", verbosity: "medium" },
      },
    },
    {
      name: "grounded game generation",
      input: {
        mode: "game" as const,
        provider: "google",
        model: "gemini-2.5-pro",
        capabilities: { reasoning: true },
        maxContext: 128_000,
        executionTarget: "embedded" as const,
      },
      expected: {
        profileId: "game-grounded",
        source: "recommended",
        parameters: { temperature: 0.6, maxTokens: 3072, reasoningEffort: "low", verbosity: "medium" },
      },
    },
    {
      name: "efficient structured generation",
      input: {
        mode: "structured" as const,
        provider: "openai",
        model: "gpt-5-mini",
        capabilities: { reasoning: true },
        maxContext: 128_000,
        executionTarget: "remote" as const,
      },
      expected: {
        profileId: "structured-efficient",
        source: "recommended",
        parameters: { temperature: 0.2, maxTokens: 2048, reasoningEffort: "low", verbosity: "low" },
      },
    },
  ])("selects $name deterministically", ({ input, expected }) => {
    expect(resolveRecommendedGenerationProfile(input)).toMatchObject({
      ...expected,
      profileVersion: 1,
    });
  });

  it("constrains output and prompt lanes for a small local model", () => {
    const profile = resolveRecommendedGenerationProfile({
      mode: "roleplay",
      provider: "custom",
      model: "qwen2.5-7b-instruct",
      capabilities: {},
      maxContext: 8_192,
      baseUrl: "http://127.0.0.1:8080/v1",
      executionTarget: "embedded",
    });

    expect(profile).toMatchObject({
      profileId: "small-local-constrained",
      source: "recommended",
      parameters: {
        temperature: 0.8,
        topP: 0.9,
        maxTokens: 1024,
      },
      promptBudgetGuidance: {
        memoryRecallTokenBudget: 384,
        lorebookTokenBudget: 1024,
        behavioralExampleTokenBudget: 96,
        behavioralExampleCandidateCap: 1,
      },
    });
    expect(profile.parameters).not.toHaveProperty("reasoningEffort");
  });

  it("uses a conservative provider-neutral fallback when model metadata is unknown", () => {
    const profile = resolveRecommendedGenerationProfile({
      mode: "conversation",
      provider: "custom",
      model: "",
      capabilities: null,
      maxContext: 128_000,
      executionTarget: "remote",
    });

    expect(profile).toMatchObject({
      profileId: "provider-neutral-fallback",
      source: "provider-neutral-fallback",
      parameters: {
        temperature: 0.7,
        topP: 1,
        maxTokens: 2048,
      },
    });
    expect(profile.parameters).not.toHaveProperty("reasoningEffort");
    expect(profile.rationale).toMatch(/metadata.*unavailable/i);
  });

  it.each([
    {
      mode: "conversation" as const,
      expected: {
        profileId: "conversation-balanced",
        parameters: { temperature: 1, topP: 0.95, maxTokens: 2048 },
      },
    },
    {
      mode: "roleplay" as const,
      expected: {
        profileId: "roleplay-expressive",
        parameters: { temperature: 1, topP: 0.95, maxTokens: 2048 },
      },
    },
    {
      mode: "visual_novel" as const,
      expected: {
        profileId: "roleplay-expressive",
        parameters: { temperature: 1, topP: 0.95, maxTokens: 2048 },
      },
    },
  ])("uses maintained GLM-5.2 sampling for NanoGPT $mode", ({ mode, expected }) => {
    const profile = resolveRecommendedGenerationProfile({
      mode,
      provider: "nanogpt",
      model: "zai-org/glm-5.2",
      capabilities: null,
      maxContext: 128_000,
      executionTarget: "remote",
    });

    expect(profile).toMatchObject({ ...expected, source: "recommended" });
    expect(profile.parameters).not.toHaveProperty("reasoningEffort");
  });

  it("does not treat unrelated NanoGPT models as maintained GLM-5.2 metadata", () => {
    expect(
      resolveRecommendedGenerationProfile({
        mode: "roleplay",
        provider: "nanogpt",
        model: "zai-org/glm-4.7",
        capabilities: null,
        maxContext: 128_000,
        executionTarget: "remote",
      }),
    ).toMatchObject({ profileId: "provider-neutral-fallback", source: "provider-neutral-fallback" });
  });

  it.each(["game", "structured"] as const)("does not change NanoGPT GLM-5.2 defaults for %s mode", (mode) => {
    expect(
      resolveRecommendedGenerationProfile({
        mode,
        provider: "nanogpt",
        model: "zai-org/glm-5.2",
        capabilities: null,
        maxContext: 128_000,
        executionTarget: "remote",
      }),
    ).toMatchObject({ profileId: "provider-neutral-fallback", source: "provider-neutral-fallback" });
  });

  it.each([
    { mode: "conversation" as const, profileId: "conversation-balanced" },
    { mode: "roleplay" as const, profileId: "roleplay-expressive" },
    { mode: "visual_novel" as const, profileId: "roleplay-expressive" },
  ])("uses Gemini-native LinkAPI defaults for $mode", ({ mode, profileId }) => {
    const profile = resolveRecommendedGenerationProfile({
      mode,
      provider: "custom",
      model: "gemini-3.5-flash",
      baseUrl: "https://linkapi.ai/v1",
      capabilities: null,
      maxContext: 1_050_000,
      executionTarget: "remote",
    });

    expect(profile).toMatchObject({
      profileId,
      source: "recommended",
      parameters: {
        maxTokens: 8192,
        reasoningEffort: "low",
        verbosity: "medium",
      },
    });
    expect(profile.parameters).not.toHaveProperty("temperature");
    expect(profile.parameters).not.toHaveProperty("topP");
    expect(profile).toMatchObject({ suppressedParameters: ["temperature", "topP"] });
  });

  it.each([
    { mode: "conversation" as const, profileId: "conversation-balanced" },
    { mode: "roleplay" as const, profileId: "roleplay-expressive" },
    { mode: "visual_novel" as const, profileId: "roleplay-expressive" },
  ])("uses transport-safe LinkAPI Claude defaults for $mode", ({ mode, profileId }) => {
    const profile = resolveRecommendedGenerationProfile({
      mode,
      provider: "custom",
      model: "[SP]claude-opus-4-7",
      baseUrl: "https://linkapi.ai/v1",
      capabilities: null,
      maxContext: 1_050_000,
      executionTarget: "remote",
    });

    expect(profile).toMatchObject({
      profileId,
      source: "recommended",
      parameters: { maxTokens: 8192 },
      suppressedParameters: ["temperature", "topP", "reasoningEffort", "verbosity"],
    });
    expect(profile.parameters).not.toHaveProperty("reasoningEffort");
    expect(profile.parameters).not.toHaveProperty("verbosity");
  });

  it("does not treat unrelated custom Gemini models as maintained LinkAPI metadata", () => {
    expect(
      resolveRecommendedGenerationProfile({
        mode: "roleplay",
        provider: "custom",
        model: "gemini-3.0-flash",
        baseUrl: "https://linkapi.ai/v1",
        capabilities: null,
        maxContext: 1_050_000,
        executionTarget: "remote",
      }),
    ).toMatchObject({ profileId: "provider-neutral-fallback", source: "provider-neutral-fallback" });
  });

  it("does not treat Claude models on unrelated custom endpoints as LinkAPI metadata", () => {
    expect(
      resolveRecommendedGenerationProfile({
        mode: "roleplay",
        provider: "custom",
        model: "[SP]claude-opus-4-7",
        baseUrl: "https://example.com/v1",
        capabilities: null,
        maxContext: 1_050_000,
        executionTarget: "remote",
      }),
    ).toMatchObject({ profileId: "provider-neutral-fallback", source: "provider-neutral-fallback" });
  });

  it.each(["game", "structured"] as const)("does not change LinkAPI Gemini 3.5 defaults for %s mode", (mode) => {
    expect(
      resolveRecommendedGenerationProfile({
        mode,
        provider: "custom",
        model: "gemini-3.5-flash",
        baseUrl: "https://linkapi.ai/v1",
        capabilities: null,
        maxContext: 1_050_000,
        executionTarget: "remote",
      }),
    ).toMatchObject({ profileId: "provider-neutral-fallback", source: "provider-neutral-fallback" });
  });

  it("resolves equivalent embedded and remote inputs to the same profile", () => {
    const input = {
      mode: "conversation" as const,
      provider: "openai",
      model: "gpt-5.2",
      capabilities: { reasoning: true },
      maxContext: 128_000,
    };

    const embedded = resolveRecommendedGenerationProfile({ ...input, executionTarget: "embedded" });
    const remote = resolveRecommendedGenerationProfile({ ...input, executionTarget: "remote" });

    expect(remote).toEqual(embedded);
  });

  it("fills prompt budgets without replacing explicit request or chat values", () => {
    const request = applyRecommendedPromptBudgetGuidance(
      {
        memoryRecallTokenBudget: 700,
        behavioralExampleTokenBudget: 60,
      },
      {
        lorebookTokenBudget: 2048,
      },
      {
        memoryRecallTokenBudget: 384,
        lorebookTokenBudget: 1024,
        behavioralExampleTokenBudget: 96,
        behavioralExampleCandidateCap: 1,
      },
    );

    expect(request).toEqual({
      memoryRecallTokenBudget: 700,
      lorebookTokenBudget: 2048,
      behavioralExampleTokenBudget: 60,
      behavioralExampleCandidateCap: 1,
    });
  });

  it("resolves prompt-budget ownership as request, then chat, then recommendation", () => {
    expect(
      applyRecommendedPromptBudgetGuidance(
        { memoryRecallTokenBudget: 700 },
        { memoryRecallTokenBudget: 500 },
        { memoryRecallTokenBudget: 384 },
      ),
    ).toMatchObject({ memoryRecallTokenBudget: 700 });

    expect(
      applyRecommendedPromptBudgetGuidance({}, { memoryRecallTokenBudget: 500 }, { memoryRecallTokenBudget: 384 }),
    ).toMatchObject({ memoryRecallTokenBudget: 500 });

    expect(
      applyRecommendedPromptBudgetGuidance(
        { memoryRecallTokenBudget: -1 },
        { memoryRecallTokenBudget: -2 },
        { memoryRecallTokenBudget: 384 },
      ),
    ).toMatchObject({ memoryRecallTokenBudget: 384 });
  });
});
