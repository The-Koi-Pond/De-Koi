import { CustomParametersField } from "./CustomParametersField";
import { FieldLabel, TEXT_AREA_CLASS } from "./field-parts";
import { NumberField } from "./NumberField";
import { OptionButtons, type Option } from "./OptionButtons";
import type { EditableGenerationParameters, GenerationServiceTier } from "./parameters";
import { ThinkingTagsField } from "./ThinkingTagsField";

type NumberKey = "temperature" | "maxTokens" | "topP" | "topK" | "frequencyPenalty" | "presencePenalty";

interface NumberSpec {
  key: NumberKey;
  label: string;
  help: string;
  min: number;
  max: number;
}

const SAMPLING_FIELDS: readonly NumberSpec[] = [
  {
    key: "temperature",
    label: "Temperature",
    help: "Controls randomness. Lower values make output more focused and deterministic; higher values make it more creative and varied.",
    min: 0,
    max: 2,
  },
  {
    key: "maxTokens",
    label: "Max Output Tokens",
    help: "The maximum number of tokens the model can generate in a single response. Higher values allow longer replies.",
    min: 1,
    max: 128000,
  },
  {
    key: "topP",
    label: "Top P",
    help: "Nucleus sampling: only considers tokens whose cumulative probability reaches this threshold. Lower values make output more focused.",
    min: 0,
    max: 1,
  },
  {
    key: "topK",
    label: "Top K",
    help: "Limits the model to only consider the top K most likely tokens at each step. 0 disables this limit.",
    min: 0,
    max: 500,
  },
];

const PENALTY_FIELDS: readonly NumberSpec[] = [
  {
    key: "frequencyPenalty",
    label: "Frequency",
    help: "Penalizes tokens based on how often they've already appeared. Positive values reduce repetition; negative values encourage it.",
    min: -2,
    max: 2,
  },
  {
    key: "presencePenalty",
    label: "Presence",
    help: "Penalizes tokens that have appeared at all, regardless of frequency. Positive values encourage the model to talk about new topics.",
    min: -2,
    max: 2,
  },
];

const PREFILL_LABEL = "Assistant Prefill";
const PREFILL_HELP =
  "Optional assistant-role text appended after the final user message. Use this only for models that support assistant prefill/continuation or need a specific opening tag.";
const SERVICE_TIER_HELP =
  "Optional provider processing tier. Unset sends no service_tier; provider defaults still apply.";
const REASONING_HELP =
  "How much the model should 'think' before responding. Higher effort produces more thoughtful, nuanced output but uses more tokens and is slower.";
const VERBOSITY_HELP =
  "Controls how long and detailed responses should be. Low keeps things concise; high encourages elaborate, descriptive output.";

const REASONING_OPTIONS: readonly Option<EditableGenerationParameters["reasoningEffort"]>[] = [
  { label: "Unset", value: null },
  { label: "None", value: "none" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "X High", value: "xhigh" },
  { label: "Maximum", value: "maximum" },
];

const VERBOSITY_OPTIONS: readonly Option<EditableGenerationParameters["verbosity"]>[] = [
  { label: "None", value: null },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

/** `standard_only` → "Standard Only"; no tier → "Unset". */
function serviceTierLabel(tier: GenerationServiceTier): string {
  if (tier === null) return "Unset";
  return tier
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface GenerationParametersFieldsProps {
  value: EditableGenerationParameters;
  onChange: (next: EditableGenerationParameters) => void;
  serviceTierOptions?: readonly GenerationServiceTier[];
  /** The level the connection's model is really sent for a reasoning effort, or null when that isn't known. */
  reasoningSentAs?: (effort: string) => string | null;
}

const reasoningLabel = (effort: string) => REASONING_OPTIONS.find((option) => option.value === effort)?.label ?? effort;

/** The reasoning effort buttons, with a note when the model is sent a different level than the one picked. */
export function ReasoningEffortField({
  value,
  onChange,
  sentAs: reasoningSentAs,
  label = "Reasoning Effort",
}: {
  value: EditableGenerationParameters["reasoningEffort"];
  onChange: (next: EditableGenerationParameters["reasoningEffort"]) => void;
  sentAs?: (effort: string) => string | null;
  label?: string;
}) {
  const sentAs = value && reasoningSentAs ? reasoningSentAs(value) : null;
  return (
    <>
      <OptionButtons
        label={label}
        help={REASONING_HELP}
        group="reasoning"
        options={REASONING_OPTIONS}
        selected={value}
        tint="purple"
        onSelect={onChange}
      />
      {value && sentAs && sentAs !== value && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          This model doesn't take {reasoningLabel(value)}; it gets {reasoningLabel(sentAs)}.
        </p>
      )}
    </>
  );
}

export function VerbosityField({
  value,
  onChange,
  label = "Verbosity",
}: {
  value: EditableGenerationParameters["verbosity"];
  onChange: (next: EditableGenerationParameters["verbosity"]) => void;
  label?: string;
}) {
  return (
    <OptionButtons
      label={label}
      help={VERBOSITY_HELP}
      group="verbosity"
      options={VERBOSITY_OPTIONS}
      selected={value}
      tint="blue"
      onSelect={onChange}
    />
  );
}

/** The shared generation parameter fields. Every edit hands over the whole value with one key replaced. */
export function GenerationParametersFields({
  value,
  onChange,
  serviceTierOptions,
  reasoningSentAs,
}: GenerationParametersFieldsProps) {
  const set = <K extends keyof EditableGenerationParameters>(key: K, next: EditableGenerationParameters[K]) =>
    onChange({ ...value, [key]: next });

  const numberGrid = (fields: readonly NumberSpec[]) => (
    <div className="grid grid-cols-2 gap-2">
      {fields.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
          help={field.help}
          value={value[field.key]}
          min={field.min}
          max={field.max}
          onCommit={(next) => set(field.key, next)}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {numberGrid(SAMPLING_FIELDS)}
      {numberGrid(PENALTY_FIELDS)}
      <div className="space-y-2">
        <div>
          <FieldLabel label={PREFILL_LABEL} help={PREFILL_HELP} />
          <textarea
            aria-label={PREFILL_LABEL}
            rows={3}
            value={value.assistantPrefill}
            placeholder="e.g. <thinking>\n"
            onChange={(event) => set("assistantPrefill", event.target.value)}
            className={`${TEXT_AREA_CLASS} resize-y`}
          />
        </div>
        <CustomParametersField value={value.customParameters} onCommit={(next) => set("customParameters", next)} />
        <ThinkingTagsField tags={value.customThinkingTags} onChange={(next) => set("customThinkingTags", next)} />
        {serviceTierOptions && serviceTierOptions.length > 0 && (
          <OptionButtons
            label="Service Tier"
            help={SERVICE_TIER_HELP}
            group="tier"
            options={serviceTierOptions.map((tier) => ({ label: serviceTierLabel(tier), value: tier }))}
            selected={value.serviceTier}
            tint="primary"
            onSelect={(next) => set("serviceTier", next)}
          />
        )}
        <ReasoningEffortField
          value={value.reasoningEffort}
          onChange={(next) => set("reasoningEffort", next)}
          sentAs={reasoningSentAs}
        />
        <VerbosityField value={value.verbosity} onChange={(next) => set("verbosity", next)} />
      </div>
    </div>
  );
}
