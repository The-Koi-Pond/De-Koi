import type { CustomThinkingTagPair, GenerationParameters } from "../../../../engine/contracts/types/prompt";

export type EditableGenerationParameters = Pick<
  GenerationParameters,
  | "temperature"
  | "maxTokens"
  | "topP"
  | "topK"
  | "frequencyPenalty"
  | "presencePenalty"
  | "reasoningEffort"
  | "verbosity"
  | "serviceTier"
  | "assistantPrefill"
  | "customThinkingTags"
  | "customParameters"
>;
export type EditableGenerationParameterOverrides = Partial<EditableGenerationParameters>;
export type GenerationServiceTier = EditableGenerationParameters["serviceTier"];

export const EDITABLE_GENERATION_PARAMETER_KEYS = [
  "temperature",
  "maxTokens",
  "topP",
  "topK",
  "frequencyPenalty",
  "presencePenalty",
  "reasoningEffort",
  "verbosity",
  "serviceTier",
  "assistantPrefill",
  "customThinkingTags",
  "customParameters",
] as const satisfies readonly (keyof EditableGenerationParameters)[];

function parameterDefaults(maxTokens: number): EditableGenerationParameters {
  return {
    temperature: 1,
    maxTokens,
    topP: 1,
    topK: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    // Unset: the model's own default. A fixed level breaks models that lack it.
    reasoningEffort: null,
    verbosity: "high",
    serviceTier: null,
    assistantPrefill: "",
    customThinkingTags: [],
    customParameters: {},
  };
}

export const CHAT_PARAMETER_DEFAULTS = parameterDefaults(4096);
export const ROLEPLAY_PARAMETER_DEFAULTS = parameterDefaults(8192);

export const MAX_CUSTOM_THINKING_TAGS = 20;

const NUMBER_KEYS = ["temperature", "maxTokens", "topP", "topK", "frequencyPenalty", "presencePenalty"] as const;

const REASONING_EFFORTS = [null, "none", "minimal", "low", "medium", "high", "xhigh", "maximum"] as const;
const VERBOSITIES = [null, "low", "medium", "high"] as const;
const SERVICE_TIERS = [null, "auto", "default", "flex", "scale", "priority", "standard_only"] as const;

const SERVICE_TIERS_BY_PROVIDER: Record<string, readonly GenerationServiceTier[]> = {
  openai: [null, "auto", "default", "flex", "scale", "priority"],
  openrouter: [null, "flex", "priority"],
  anthropic: [null, "auto", "standard_only"],
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

/** A stored parameter record: an object, or JSON text of one. */
export function parseGenerationParameterRecord(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isPlainRecord(value) ? value : null;
}

function isFilledText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseThinkingTags(raw: unknown): CustomThinkingTagPair[] {
  if (!Array.isArray(raw)) return [];
  const tags: CustomThinkingTagPair[] = [];
  for (const entry of raw) {
    if (isPlainRecord(entry) && isFilledText(entry.open) && isFilledText(entry.close)) {
      tags.push({ open: entry.open.trim(), close: entry.close.trim() });
    }
  }
  return tags.slice(0, MAX_CUSTOM_THINKING_TAGS);
}

/** The editable keys a stored record sets, or null when it sets none. */
export function parseEditableGenerationParameters(raw: unknown): EditableGenerationParameterOverrides | null {
  const record = parseGenerationParameterRecord(raw);
  if (!record) return null;
  const parsed: EditableGenerationParameterOverrides = {};
  for (const key of NUMBER_KEYS) {
    const value = record[key];
    if (typeof value === "number") parsed[key] = value;
  }
  if (isOneOf(REASONING_EFFORTS, record.reasoningEffort)) parsed.reasoningEffort = record.reasoningEffort;
  if (isOneOf(VERBOSITIES, record.verbosity)) parsed.verbosity = record.verbosity;
  if (isOneOf(SERVICE_TIERS, record.serviceTier)) parsed.serviceTier = record.serviceTier;
  if (typeof record.assistantPrefill === "string") parsed.assistantPrefill = record.assistantPrefill;
  if ("customThinkingTags" in record) parsed.customThinkingTags = parseThinkingTags(record.customThinkingTags);
  const customParameters = record.customParameters;
  if (isPlainRecord(customParameters) && Object.keys(customParameters).length > 0) {
    parsed.customParameters = customParameters;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isPlainRecord(current) && isPlainRecord(value) ? mergeRecords(current, value) : value;
  }
  return merged;
}

/** `defaults` with every editable key the stored overrides set; custom parameters are deep-merged. */
export function getEditableGenerationParameters(
  defaults: EditableGenerationParameters,
  overrides: unknown,
): EditableGenerationParameters {
  const parsed = parseEditableGenerationParameters(overrides);
  if (!parsed) return defaults;
  return {
    ...defaults,
    ...parsed,
    customParameters: parsed.customParameters
      ? mergeRecords(defaults.customParameters, parsed.customParameters)
      : defaults.customParameters,
  };
}

/** JSON with object keys sorted at every level, so key order doesn't count as a difference. */
function stableJson(value: unknown): string | undefined {
  const sortKeys = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sortKeys);
    if (!isPlainRecord(item)) return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, sortKeys(item[key])]),
    );
  };
  return JSON.stringify(sortKeys(value));
}

/** The editable keys whose value differs from `defaults`, or null when none does. */
export function getEditableGenerationParameterOverrides(
  defaults: EditableGenerationParameters,
  value: EditableGenerationParameters,
): EditableGenerationParameterOverrides | null {
  const overrides: Record<string, unknown> = {};
  for (const key of EDITABLE_GENERATION_PARAMETER_KEYS) {
    const differs =
      key === "customParameters" || key === "customThinkingTags"
        ? stableJson(value[key]) !== stableJson(defaults[key])
        : value[key] !== defaults[key];
    if (differs) overrides[key] = value[key];
  }
  return Object.keys(overrides).length > 0 ? (overrides as EditableGenerationParameterOverrides) : null;
}

export function serviceTierOptionsForProvider(provider: unknown): readonly GenerationServiceTier[] | undefined {
  return typeof provider === "string" && Object.hasOwn(SERVICE_TIERS_BY_PROVIDER, provider)
    ? SERVICE_TIERS_BY_PROVIDER[provider]
    : undefined;
}
