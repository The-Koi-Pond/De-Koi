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

function finiteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
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
    const value = guidance[key];
    if (!finiteNumber(value) || finiteNumber(request[key])) return;
    if (chatScoped && finiteNumber(chatMetadata[key])) return;
    next[key] = value;
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
  return hasAdvertisedModelMetadata(input.capabilities) || modelMatchesMaintainedFamily(provider, model);
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
    return {
      profileId: "roleplay-expressive",
      profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
      source: "recommended",
      rationale: "Favors expressive roleplay while keeping output and reasoning bounded.",
      parameters: withReasoning(
        {
          temperature: 1,
          topP: 0.95,
          maxTokens: boundedOutputTokens(4096, maxContext),
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

  return {
    profileId: "conversation-balanced",
    profileVersion: RECOMMENDED_GENERATION_PROFILE_VERSION,
    source: "recommended",
    rationale: "Uses balanced sampling and avoids maximum reasoning effort for routine conversation.",
    parameters: withReasoning(
      {
        temperature: 0.7,
        topP: 0.95,
        maxTokens: boundedOutputTokens(2048, maxContext),
        verbosity: "medium",
      },
      input,
    ),
    promptBudgetGuidance: {},
  };
}
