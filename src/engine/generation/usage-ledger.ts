import type { AgentResult } from "../contracts/types/agent";
import type { GenerationTurnUsage, NormalizedTokenUsage } from "../contracts/types/chat";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstCount(source: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = count(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function nestedCount(source: UnknownRecord, parentKeys: readonly string[], keys: readonly string[]): number | null {
  for (const parentKey of parentKeys) {
    const value = firstCount(record(source[parentKey]), keys);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeTokenUsage(raw: unknown): NormalizedTokenUsage {
  const source = record(raw);
  const promptTokens = firstCount(source, [
    "promptTokens",
    "prompt_tokens",
    "inputTokens",
    "input_tokens",
    "promptTokenCount",
  ]);
  const completionTokens = firstCount(source, [
    "completionTokens",
    "completion_tokens",
    "outputTokens",
    "output_tokens",
    "candidatesTokenCount",
  ]);
  const cachedPromptTokens =
    firstCount(source, [
      "cachedPromptTokens",
      "cached_prompt_tokens",
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cachedContentTokenCount",
    ]) ??
    nestedCount(
      source,
      ["promptTokensDetails", "prompt_tokens_details", "inputTokensDetails", "input_tokens_details"],
      ["cachedTokens", "cached_tokens"],
    );
  const cacheWritePromptTokens = firstCount(source, [
    "cacheWritePromptTokens",
    "cache_write_prompt_tokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ]);
  const explicitTotal = firstCount(source, ["totalTokens", "total_tokens", "totalTokenCount"]);
  const totalTokens =
    explicitTotal ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);

  return { promptTokens, completionTokens, cachedPromptTokens, cacheWritePromptTokens, totalTokens };
}

export function buildGenerationTurnUsage(
  rawMain: unknown,
  agentResults: readonly Pick<AgentResult, "tokensUsed">[],
): GenerationTurnUsage {
  const main = normalizeTokenUsage(rawMain);
  const agentTotal = agentResults.reduce((total, result) => total + (count(result.tokensUsed) ?? 0), 0);
  return {
    main,
    agents: { totalTokens: agentTotal, resultCount: agentResults.length },
    totalTokens: main.totalTokens === null ? null : main.totalTokens + agentTotal,
  };
}
