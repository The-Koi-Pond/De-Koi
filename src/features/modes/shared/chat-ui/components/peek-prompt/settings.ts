import type { PeekPromptData } from "../../types";
import { formatCount } from "./format";

export type SettingPill = { label: string; value: string };

type GenerationInfo = NonNullable<PeekPromptData["generationInfo"]>;
type Values = Record<string, unknown>;
type Rule = { label: string; key: string; show: (value: unknown) => boolean; value?: (value: unknown) => string };

const set = (value: unknown) => value != null;
const notDefault = (fallback: unknown) => (value: unknown) => value != null && value !== fallback;
const truthy = (value: unknown) => Boolean(value);
const on = () => "On";
const tokens = (value: unknown) => formatCount(value as number);

const GENERATION_INFO_RULES: Rule[] = [
  { label: "Temperature", key: "temperature", show: set },
  { label: "Max Output Tokens", key: "maxTokens", show: set, value: tokens },
  { label: "Top P", key: "topP", show: notDefault(1) },
  { label: "Top K", key: "topK", show: notDefault(0) },
  { label: "Freq Penalty", key: "frequencyPenalty", show: notDefault(0) },
  { label: "Pres Penalty", key: "presencePenalty", show: notDefault(0) },
  { label: "Thinking", key: "showThoughts", show: truthy, value: on },
  { label: "Reasoning", key: "reasoningEffort", show: truthy },
  { label: "Verbosity", key: "verbosity", show: truthy },
  { label: "Service Tier", key: "serviceTier", show: truthy },
  { label: "Assistant Prefill", key: "assistantPrefill", show: truthy, value: on },
];

const PARAMETER_RULES: Rule[] = [
  { label: "Temperature", key: "temperature", show: set },
  { label: "Top P", key: "topP", show: notDefault(1) },
  { label: "Top K", key: "topK", show: notDefault(0) },
  { label: "Min P", key: "minP", show: notDefault(0) },
  { label: "Max Output Tokens", key: "maxTokens", show: set, value: tokens },
  { label: "Freq Penalty", key: "frequencyPenalty", show: notDefault(0) },
  { label: "Pres Penalty", key: "presencePenalty", show: notDefault(0) },
  { label: "Thinking", key: "showThoughts", show: truthy, value: on },
  { label: "Reasoning", key: "reasoningEffort", show: truthy },
  { label: "Verbosity", key: "verbosity", show: truthy },
  { label: "Service Tier", key: "serviceTier", show: truthy },
  { label: "Assistant Prefill", key: "assistantPrefill", show: truthy, value: on },
];

function pillsFrom(values: Values, rules: Rule[]): SettingPill[] {
  return rules
    .filter((rule) => rule.show(values[rule.key]))
    .map((rule) => ({ label: rule.label, value: (rule.value ?? String)(values[rule.key]) }));
}

/** Pills come from the generation info when there is any, else from the request parameters. */
export function settingPills(generationInfo: GenerationInfo | null | undefined, parameters: unknown): SettingPill[] {
  if (generationInfo) return pillsFrom(generationInfo as Values, GENERATION_INFO_RULES);
  if (parameters) return pillsFrom(parameters as Values, PARAMETER_RULES);
  return [];
}

type PresetSummary = { id: string; name?: string | null };

/** The preset's trimmed name, else its trimmed id; null when there is no id. */
export function presetLabel(promptPresetId: string | null | undefined, presets: PresetSummary[] | undefined) {
  const id = promptPresetId?.trim();
  if (!id) return null;
  const match = presets?.find((preset) => preset.id === id);
  return match?.name?.trim() || id;
}
