import type { StorageGateway } from "../../../capabilities/storage";
import { parseJsonObject } from "../../../core/json";
import type { SceneFullPlan } from "../../../contracts/types/scene";
import { readString as stringValue } from "../../../shared/value-readers";

const DE_KOI_UNIVERSAL_PRESET_ID = "preset_universal_v2";

type JsonRecord = Record<string, unknown>;

type UniversalChoiceHints = Record<string, string>;

type PromptChoiceBlock = JsonRecord & {
  variableName?: unknown;
  variable_name?: unknown;
  options?: unknown;
};

const DEFAULT_UNIVERSAL_CHOICE_HINTS: UniversalChoiceHints = {
  mode: "mode_gm",
  contentBoundary: "boundary_sfw",
  eroticTone: "erotic_tone_none",
  agencyStrictness: "agency_strict",
  pacing: "pacing_balanced",
  styleFlavor: "style_grounded",
  narration: "narration_second",
  pov: "pov_user_limited",
  tense: "tense_present",
  length: "length_flexible",
  language: "language_english",
};

const SEXUAL_RE =
  /\b(?:explicit|nsfw|sexual|sex|erotic|sensual|arous(?:al|ed|ing)|desire|lust|seduc(?:e|tion|tive)|make out|kiss(?:ing)?|bedroom|intimate|naked|nude|undress|dirty talk|filthy)\b/i;
const FILTHY_RE = /\b(?:filthy|dirty talk|raunchy|vulgar|depraved|nasty|slutty|pornographic|hardcore)\b/i;
const DIRECT_RE = /\b(?:explicit|direct|blunt|anatomical|graphic|uncensored)\b/i;
const SENSUAL_RE = /\b(?:sensual|romantic|intimate|tender|slow burn|slow-burn|seductive)\b/i;
const SFW_RE = /\b(?:sfw|fade to black|non-explicit|nonsexual|no sex|keep it clean)\b/i;
const THIRD_PERSON_RE = /\b(?:third person|third-person|by name|their perspective)\b/i;
const FIRST_PERSON_RE = /\b(?:first person|first-person|\bi\s+narrat(?:e|ion))\b/i;
const PAST_TENSE_RE = /\b(?:past tense|past-tense)\b/i;
const SLOW_BURN_RE = /\b(?:slow burn|slow-burn|linger|lingering)\b/i;
const SNAPPY_RE = /\b(?:snappy|quick|fast paced|fast-paced|short turns?)\b/i;
const CINEMATIC_RE = /\b(?:cinematic|wide shot|sweeping|set piece)\b/i;

export async function resolveSceneUniversalPreset(
  storage: StorageGateway,
  args: {
    plan: SceneFullPlan;
    sceneConversationContext: string;
  },
): Promise<{ presetId: string | null; presetChoices: JsonRecord; choiceHints: UniversalChoiceHints }> {
  const presetId = (await promptPresetExists(storage, DE_KOI_UNIVERSAL_PRESET_ID)) ? DE_KOI_UNIVERSAL_PRESET_ID : null;
  const choiceHints = inferSceneUniversalChoiceHints(args.plan, args.sceneConversationContext);
  if (!presetId) return { presetId: null, presetChoices: {}, choiceHints };

  const blocks = await storage.list<PromptChoiceBlock>("prompt-variables", { filters: { presetId } }).catch(() => []);
  const presetChoices = resolveChoiceValues(blocks, choiceHints);
  return { presetId, presetChoices, choiceHints };
}

function inferSceneUniversalChoiceHints(plan: SceneFullPlan, sceneConversationContext: string): UniversalChoiceHints {
  const planHints = parseStringRecord((plan as SceneFullPlan & { presetChoices?: unknown }).presetChoices);
  const text = [
    plan.description,
    plan.scenario,
    plan.firstMessage,
    plan.systemPrompt,
    plan.relationshipHistory,
    sceneConversationContext,
  ]
    .join("\n")
    .toLowerCase();
  const explicit = plan.rating === "nsfw" || (SEXUAL_RE.test(text) && !SFW_RE.test(text));

  return {
    ...DEFAULT_UNIVERSAL_CHOICE_HINTS,
    contentBoundary: explicit ? "boundary_mature_dark" : "boundary_sfw",
    eroticTone: inferEroticTone(text, explicit),
    narration: FIRST_PERSON_RE.test(text)
      ? "narration_first"
      : THIRD_PERSON_RE.test(text)
        ? "narration_third"
        : DEFAULT_UNIVERSAL_CHOICE_HINTS.narration,
    tense: PAST_TENSE_RE.test(text) ? "tense_past" : DEFAULT_UNIVERSAL_CHOICE_HINTS.tense,
    pacing: inferPacing(text),
    ...planHints,
  };
}

function inferEroticTone(text: string, explicit: boolean): string {
  if (!explicit) return "erotic_tone_none";
  if (FILTHY_RE.test(text)) return "erotic_tone_filthy";
  if (DIRECT_RE.test(text)) return "erotic_tone_direct";
  if (SENSUAL_RE.test(text)) return "erotic_tone_sensual";
  return "erotic_tone_restrained";
}

function inferPacing(text: string): string {
  if (SLOW_BURN_RE.test(text)) return "pacing_slow_burn";
  if (SNAPPY_RE.test(text)) return "pacing_snappy";
  if (CINEMATIC_RE.test(text)) return "pacing_cinematic";
  return DEFAULT_UNIVERSAL_CHOICE_HINTS.pacing;
}

async function promptPresetExists(storage: StorageGateway, presetId: string): Promise<boolean> {
  const full = await storage.promptFull?.<unknown>(presetId).catch(() => null);
  if (isRecord(full) && isRecord(full.preset)) return true;
  const direct = await storage.get("prompts", presetId).catch(() => null);
  if (isRecord(direct)) return true;
  const prompts = await storage.list<JsonRecord>("prompts").catch(() => []);
  return prompts.some((prompt) => stringValue(prompt.id).trim() === presetId);
}

function resolveChoiceValues(blocks: PromptChoiceBlock[], hints: UniversalChoiceHints): JsonRecord {
  const choices: JsonRecord = {};
  for (const block of blocks) {
    const variableName = stringValue(block.variableName ?? block.variable_name).trim();
    const hint = hints[variableName];
    if (!variableName || !hint) continue;
    const value = resolveChoiceValue(block.options, hint);
    if (value) choices[variableName] = value;
  }
  return choices;
}

function resolveChoiceValue(options: unknown, hint: string): string | null {
  if (!Array.isArray(options)) return null;
  const normalizedHint = normalizeChoiceMatch(hint);
  for (const option of options) {
    const record = parseJsonObject(option);
    const candidates = [record.id, record.label, record.value].map((value) => normalizeChoiceMatch(value));
    if (candidates.includes(normalizedHint)) {
      return (
        stringValue(record.value).trim() || stringValue(record.label).trim() || stringValue(record.id).trim() || null
      );
    }
  }
  return null;
}

function parseStringRecord(value: unknown): UniversalChoiceHints {
  const record = parseJsonObject(value);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [key, stringValue(entry).trim()] as const)
      .filter(([, entry]) => entry.length > 0),
  );
}

function normalizeChoiceMatch(value: unknown): string {
  return stringValue(value).trim().toLowerCase();
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
