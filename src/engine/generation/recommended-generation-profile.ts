import type { GenerationParameters } from "../contracts/types/prompt";

export const RECOMMENDED_GENERATION_PROFILE_VERSION = 1 as const;

export type RecommendedGenerationMode = "conversation" | "roleplay" | "visual_novel" | "game" | "structured" | "agent";

export type RecommendedGenerationProfileSource = "recommended" | "provider-neutral-fallback";

export type RecommendedGenerationParameters = Partial<
  Pick<GenerationParameters, "temperature" | "topP" | "maxTokens" | "reasoningEffort" | "verbosity">
>;

export interface RecommendedPromptBudgetGuidance {
  memoryRecallTokenBudget?: number;
  lorebookTokenBudget?: number;
  behavioralExampleTokenBudget?: number;
  behavioralExampleCandidateCap?: number;
}

export interface RecommendedGenerationProfile {
  profileId:
    | "conversation-balanced"
    | "roleplay-expressive"
    | "game-grounded"
    | "structured-efficient"
    | "small-local-constrained"
    | "provider-neutral-fallback";
  profileVersion: typeof RECOMMENDED_GENERATION_PROFILE_VERSION;
  source: RecommendedGenerationProfileSource;
  rationale: string;
  parameters: RecommendedGenerationParameters;
  suppressedParameters?: Array<keyof GenerationParameters>;
  promptBudgetGuidance: RecommendedPromptBudgetGuidance;
}

export interface RecommendedGenerationProfileInput {
  mode: RecommendedGenerationMode | string;
  provider?: string | null;
  model?: string | null;
  capabilities?: Record<string, unknown> | null;
  maxContext?: number | null;
  baseUrl?: string | null;
  executionTarget?: "embedded" | "remote";
  metadataStale?: boolean;
}

type PromptBudgetRequest = Record<string, unknown>;

function normalizedPromptBudget(key: keyof RecommendedPromptBudgetGuidance, value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (key === "lorebookTokenBudget") return normalized >= 0 ? normalized : undefined;
  return normalized > 0 ? normalized : undefined;
}

/**
 * Fill only otherwise-unset prompt budget controls. Explicit request and
 * chat-scoped budgets remain authoritative.
 */
export function applyRecommendedPromptBudgetGuidance(
  request: PromptBudgetRequest,
  chatMetadata: Record<string, unknown>,
  guidance: RecommendedPromptBudgetGuidance,
): PromptBudgetRequest {
  const next = { ...request };
  const maybeSet = (key: keyof RecommendedPromptBudgetGuidance, chatScoped = false) => {
    const requestValue = normalizedPromptBudget(key, request[key]);
    if (requestValue !== undefined) {
      next[key] = requestValue;
      return;
    }

    const chatValue = chatScoped ? normalizedPromptBudget(key, chatMetadata[key]) : undefined;
    if (chatValue !== undefined) {
      next[key] = chatValue;
      return;
    }

    const recommendedValue = normalizedPromptBudget(key, guidance[key]);
    if (recommendedValue !== undefined) {
      next[key] = recommendedValue;
    } else {
      delete next[key];
    }
  };

  maybeSet("memoryRecallTokenBudget", true);
  maybeSet("lorebookTokenBudget", true);
  maybeSet("behavioralExampleTokenBudget");
  maybeSet("behavioralExampleCandidateCap");
  return next;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function boundedOutputTokens(target: number, maxContext: number | null): number {
  if (!maxContext) return target;
  return Math.min(target, Math.max(256, Math.floor(maxContext * 0.2)));
}

function hasAdvertisedModelMetadata(capabilities: Record<string, unknown> | null | undefined): boolean {
  if (!capabilities) return false;
  return ["reasoning", "streaming", "toolUse", "tool_use", "vision"].some(
    (key) => typeof capabilities[key] === "boolean",
  );
}

function isGlm52Model(model: string): boolean {
  return /(?:^|[/:\s-])glm[-_.]?5[._-]?2(?:$|[/:\s-])/.test(model);
}

function isGemini35Model(model: string): boolean {
  return /(?:^|[/:\s-])gemini[-_.]?3[._-]?5(?:$|[/:\s-])/.test(model);
}

function modelMatchesMaintainedFamily(provider: string, model: string): boolean {
  if (!model) return false;
  switch (provider) {
    case "openai":
    case "openai_chatgpt":
      return /(?:^|[/:\s-])(?:gpt|o[1-9])/.test(model);
    case "anthropic":
    case "claude_subscription":
      return model.includes("claude");
    case "google":
    case "google_vertex":
      return model.includes("gemini");
    case "mistral":
      return /(?:mistral|mixtral|codestral|ministral)/.test(model);
    case "cohere":
      return model.includes("command");
    case "xai":
      return model.includes("grok");
    default:
      return false;
  }
}

function isNanoGlm52(input: RecommendedGenerationProfileInput): boolean {
  return normalized(input.provider) === "nanogpt" && isGlm52Model(normalized(input.model));
}

function isSupportedNanoGlm52Mode(input: RecommendedGenerationProfileInput): boolean {
  const mode = normalized(input.mode);
  return isNanoGlm52(input) && (mode === "conversation" || mode === "roleplay" || mode === "visual_novel");
}

function isLinkApiGemini35(input: RecommendedGenerationProfileInput): boolean {
  const baseUrl = normalized(input.baseUrl);
  return (
    normalized(input.provider) === "custom" &&
    /^(?:https?:\/\/)?(?:www\.)?linkapi\.ai(?::|\/|$)/.test(baseUrl) &&
    isGemini35Model(normalized(input.model))
  );
}

function isLinkApi(input: RecommendedGenerationProfileInput): boolean {
  const baseUrl = normalized(input.baseUrl);
  return normalized(input.provider) === "custom" && /^(?:https?:\/\/)?(?:www\.)?linkapi\.ai(?::|\/|$)/.test(baseUrl);
}

function isLinkApiClaude(input: RecommendedGenerationProfileInput): boolean {
  if (!isLinkApi(input)) return false;
  const modelId = normalized(input.model)
    .replace(/^\[[^\]]+\]/, "")
    .split("/")
    .at(-1)
    ?.replace(/[._]/g, "-");
  if (!modelId) return false;
  const family = "(?:opus|sonnet|haiku|fable|mythos)";
  return new RegExp(`^claude-(?:${family}-\\d+(?:-\\d+)*|\\d+(?:-\\d+)*-${family})(?:$|[-\\[])`).test(modelId);
}

function isSupportedLinkApiGemini35Mode(input: RecommendedGenerationProfileInput): boolean {
  const mode = normalized(input.mode);
  return isLinkApiGemini35(input) && (mode === "conversation" || mode === "roleplay" || mode === "visual_novel");
}

function isSupportedLinkApiClaudeMode(input: RecommendedGenerationProfileInput): boolean {
  const mode = normalized(input.mode);
  return isLinkApiClaude(input) && (mode === "conversation" || mode === "roleplay" || mode === "visual_novel");
}

function reasoningCapable(input: RecommendedGenerationProfileInput): boolean {
  if (input.capabilities?.reasoning === true) return true;
  const provider = normalized(input.provider);
  const model = normalized(input.model);
  if (provider === "openai" || provider === "openai_chatgpt") {
    return /(?:^|[/:\s-])(?:gpt-5|o[1-9])/.test(model);
  }
  if (provider === "google" || provider === "google_vertex") {
    return /gemini-(?:2\.5|3)/.test(model);
  }
  if (provider === "xai") return /(?:^|\/)grok-4/.test(model);
  return false;
}

function smallLocalContext(input: RecommendedGenerationProfileInput, maxContext: number | null): boolean {
  if (!maxContext || maxContext > 32_768) return false;
  const provider = normalized(input.provider);
  const baseUrl = normalized(input.baseUrl);
  return provider === "custom" || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(baseUrl);
}

function knownModelMetadata(input: RecommendedGenerationProfileInput): boolean {
  if (input.metadataStale === true) return false;
  const provider = normalized(input.provider);
  const model = normalized(input.model);
  return (
    hasAdvertisedModelMetadata(input.capabilities) ||
    modelMatchesMaintainedFamily(provider, model) ||
    isSupportedNanoGlm52Mode(input) ||
    isSupportedLinkApiGemini35Mode(input) ||
    isSupportedLinkApiClaudeMode(input)
  );
}

function withReasoning(
  parameters: RecommendedGenerationParameters,
  input: RecommendedGenerationProfileInput,
): RecommendedGenerationParameters {
  return reasoningCapable(input) ? { ...parameters, reasoningEffort: "low" } : parameters;
}

export function resolveRecommendedGenerationProfile(
  input: RecommendedGenerationProfileInput,
): RecommendedGenerationProfile {
  const maxContext = positiveInteger(input.maxContext);
  if (smallLocalContext(input, maxContext)) {
    return {
      profileId: "small-local-constrained",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Uses smaller output and prompt-context budgets for a constrained local model window.",
      parameters: {
        temperature: 0.8,
        topP: 0.9,
        maxTokens: boundedOutputTokens(1024, maxContext),
      },
      promptBudgetGuidance: {
        memoryRecallTokenBudget: 384,
        lorebookTokenBudget: 1024,
        behavioralExampleTokenBudget: 96,
        behavioralExampleCandidateCap: 1,
      },
    };
  }

  if (!knownModelMetadata(input)) {
    return {
      profileId: "provider-neutral-fallback",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "provider-neutral-fallback",
      rationale: "Model metadata is unavailable or stale, so provider-neutral conservative defaults are used.",
      parameters: {
        temperature: 0.7,
        topP: 1,
        maxTokens: boundedOutputTokens(2048, maxContext),
      },
      promptBudgetGuidance: {},
    };
  }

  const mode = normalized(input.mode);
  if (mode === "roleplay" || mode === "visual_novel") {
    if (isLinkApiGemini35(input)) {
      return {
        profileId: "roleplay-expressive",
        profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
        source: "recommended",
        rationale: "Uses Gemini-native sampling and low reasoning for natural LinkAPI roleplay output.",
        parameters: {
          maxTokens: boundedOutputTokens(8192, maxContext),
          reasoningEffort: "low",
          verbosity: "medium",
        },
        suppressedParameters: ["temperature", "topP"],
        promptBudgetGuidance: {},
      };
    }
    if (isLinkApiClaude(input)) {
      return {
        profileId: "roleplay-expressive",
        profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
        source: "recommended",
        rationale:
          "Uses transport-safe LinkAPI Claude chat-completions defaults; adaptive thinking requires the native Anthropic route.",
        parameters: { maxTokens: boundedOutputTokens(8192, maxContext) },
        suppressedParameters: ["temperature", "topP", "reasoningEffort", "verbosity"],
        promptBudgetGuidance: {},
      };
    }
    if (isNanoGlm52(input)) {
      return {
        profileId: "roleplay-expressive",
        profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
        source: "recommended",
        rationale: "Uses maintained GLM-5.2 sampling and a bounded roleplay output window.",
        parameters: {
          temperature: 1,
          topP: 0.95,
          maxTokens: boundedOutputTokens(2048, maxContext),
        },
        suppressedParameters: ["topK", "reasoningEffort", "verbosity"],
        promptBudgetGuidance: {},
      };
    }
    return {
      profileId: "roleplay-expressive",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Favors expressive roleplay while keeping output and reasoning bounded.",
      parameters: withReasoning(
        {
          temperature: 1,
          topP: 0.95,
          maxTokens: boundedOutputTokens(isNanoGlm52(input) ? 2048 : 4096, maxContext),
          verbosity: "medium",
        },
        input,
      ),
      promptBudgetGuidance: {},
    };
  }

  if (mode === "game") {
    return {
      profileId: "game-grounded",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Balances grounded game-state continuity with room for descriptive output.",
      parameters: withReasoning(
        {
          temperature: 0.6,
          topP: 0.9,
          maxTokens: boundedOutputTokens(3072, maxContext),
          verbosity: "medium",
        },
        input,
      ),
      promptBudgetGuidance: {},
    };
  }

  if (mode === "structured" || mode === "agent") {
    return {
      profileId: "structured-efficient",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Uses focused sampling and bounded reasoning for structured or agent output.",
      parameters: withReasoning(
        {
          temperature: 0.2,
          topP: 1,
          maxTokens: boundedOutputTokens(2048, maxContext),
          verbosity: "low",
        },
        input,
      ),
      promptBudgetGuidance: {},
    };
  }

  if (isLinkApiGemini35(input)) {
    return {
      profileId: "conversation-balanced",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Uses Gemini-native sampling and low reasoning for natural LinkAPI conversation output.",
      parameters: {
        maxTokens: boundedOutputTokens(8192, maxContext),
        reasoningEffort: "low",
        verbosity: "medium",
      },
      suppressedParameters: ["temperature", "topP"],
      promptBudgetGuidance: {},
    };
  }

  if (isLinkApiClaude(input)) {
    return {
      profileId: "conversation-balanced",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale:
        "Uses transport-safe LinkAPI Claude chat-completions defaults; adaptive thinking requires the native Anthropic route.",
      parameters: { maxTokens: boundedOutputTokens(8192, maxContext) },
      suppressedParameters: ["temperature", "topP", "reasoningEffort", "verbosity"],
      promptBudgetGuidance: {},
    };
  }

  if (isNanoGlm52(input)) {
    return {
      profileId: "conversation-balanced",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Uses maintained GLM-5.2 sampling and a bounded conversation output window.",
      parameters: {
        temperature: 1,
        topP: 0.95,
        maxTokens: boundedOutputTokens(2048, maxContext),
      },
      suppressedParameters: ["topK", "reasoningEffort", "verbosity"],
      promptBudgetGuidance: {},
    };
  }

  return {
    profileId: "conversation-balanced",
    profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
    source: "recommended",
    rationale: "Uses balanced sampling and avoids maximum reasoning effort for routine conversation.",
    parameters: withReasoning(
      {
        temperature: isNanoGlm52(input) ? 1 : 0.7,
        topP: 0.95,
        maxTokens: boundedOutputTokens(2048, maxContext),
        verbosity: "medium",
      },
      input,
    ),
    promptBudgetGuidance: {},
  };
}
