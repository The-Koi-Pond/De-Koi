import type { LlmMessage } from "../capabilities/llm";
import { effectiveMaxContext, estimateLlmMessageTokens } from "./context-window";
import { readNumber, readString } from "./runtime-records";

const DEFAULT_RESPONSE_TOKENS = 4096;
const CONTEXT_SAFETY_TOKENS = 256;
const LARGE_SECTION_TOKENS = 1000;

type PromptBudgetSectionKind =
  | "preset"
  | "character"
  | "persona"
  | "lorebook"
  | "memory"
  | "history"
  | "attachment"
  | "injection"
  | "game"
  | "other";

type PromptBudgetTrimRisk = "none" | "medium" | "high";

type PromptBudgetWarningKind =
  | "unknown_limit"
  | "near_limit"
  | "over_budget"
  | "large_section"
  | "context_overlap"
  | "lorebook_skipped"
  | "history_trim";

interface PromptBudgetSection {
  kind: PromptBudgetSectionKind;
  label: string;
  estimatedTokens: number;
  messageCount: number;
  trimRisk: PromptBudgetTrimRisk;
}

interface PromptBudgetWarning {
  kind: PromptBudgetWarningKind;
  message: string;
  sectionKind?: PromptBudgetSectionKind;
  sectionLabel?: string;
  tokens?: number;
  overlapPhrase?: string;
  sourceLabels?: string[];
}

export interface PromptBudgetEstimate {
  contextLimit: number | null;
  estimatedPromptTokens: number;
  outputReserveTokens: number | null;
  safetyReserveTokens: number | null;
  inputBudgetTokens: number | null;
  remainingTokens: number | null;
  sections: PromptBudgetSection[];
  warnings: PromptBudgetWarning[];
}

interface PromptBudgetMessage extends LlmMessage {
  contextKind?: unknown;
  displayName?: unknown;
}

interface PromptBudgetInput {
  messages: LlmMessage[];
  connection?: Record<string, unknown> | null;
  parameters?: Record<string, unknown> | null;
  budgetSkippedLorebookEntries?: Array<{ name?: unknown; id?: unknown; lorebookId?: unknown }> | null;
}

function normalizedLabel(message: PromptBudgetMessage): string {
  return readString(message.displayName || message.name).trim();
}

function normalizedSearchText(message: PromptBudgetMessage): string {
  return `${normalizedLabel(message)}\n${message.content ?? ""}`.toLowerCase();
}

function classifyPromptMessage(message: PromptBudgetMessage): PromptBudgetSectionKind {
  const contextKind = readString(message.contextKind).trim();
  const text = normalizedSearchText(message);
  if (contextKind === "history") return "history";
  if (message.images?.length) return "attachment";
  if (contextKind === "injection") return "injection";
  if (/\b(lorebook|world info|world_info|world facts?)\b/.test(text)) return "lorebook";
  if (/\b(character|char card|character info|character_info)\b/.test(text)) return "character";
  if (/\b(persona|user profile)\b/.test(text)) return "persona";
  if (/\b(summary|memory|notes?|recall)\b/.test(text)) return "memory";
  if (/\b(game|gm|quest|party|morale|hud|tracker|map)\b/.test(text)) return "game";
  if (contextKind === "prompt" || message.role === "system") return "preset";
  return "other";
}

function sectionLabel(kind: PromptBudgetSectionKind): string {
  switch (kind) {
    case "preset":
      return "System and Preset";
    case "character":
      return "Character Context";
    case "persona":
      return "Persona Context";
    case "lorebook":
      return "Lorebook";
    case "memory":
      return "Summary and Memory";
    case "history":
      return "Recent Chat History";
    case "attachment":
      return "Attachments";
    case "injection":
      return "Injected Context";
    case "game":
      return "Game Context";
    default:
      return "Other Context";
  }
}

function outputReserve(parameters: Record<string, unknown> | null | undefined): number {
  return Math.max(1, readNumber(parameters?.maxTokens, DEFAULT_RESPONSE_TOKENS));
}

function sectionTrimRisk(
  section: PromptBudgetSection,
  inputBudgetTokens: number | null,
  remainingTokens: number | null,
): PromptBudgetTrimRisk {
  if (section.kind !== "history" && section.kind !== "lorebook") return "none";
  if (remainingTokens != null && remainingTokens < 0) return "high";
  if (inputBudgetTokens != null && inputBudgetTokens > 0 && section.estimatedTokens > inputBudgetTokens * 0.35) {
    return "medium";
  }
  return "none";
}

function buildSections(
  messages: LlmMessage[],
  inputBudgetTokens: number | null,
  remainingTokens: number | null,
): PromptBudgetSection[] {
  const byKind = new Map<PromptBudgetSectionKind, PromptBudgetSection>();
  for (const rawMessage of messages) {
    const message = rawMessage as PromptBudgetMessage;
    const kind = classifyPromptMessage(message);
    const estimatedTokens = estimateLlmMessageTokens(rawMessage);
    const existing = byKind.get(kind);
    if (existing) {
      existing.estimatedTokens += estimatedTokens;
      existing.messageCount += 1;
    } else {
      byKind.set(kind, {
        kind,
        label: sectionLabel(kind),
        estimatedTokens,
        messageCount: 1,
        trimRisk: "none",
      });
    }
  }
  const sections = [...byKind.values()];
  for (const section of sections) {
    section.trimRisk = sectionTrimRisk(section, inputBudgetTokens, remainingTokens);
  }
  return sections;
}

interface PromptContextOverlap {
  phrase: string;
  sourceLabels: string[];
}

const OVERLAP_SOURCE_KINDS = new Set<PromptBudgetSectionKind>([
  "character",
  "lorebook",
  "memory",
  "injection",
  "persona",
]);

const OVERLAP_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "because",
  "been",
  "before",
  "being",
  "between",
  "from",
  "have",
  "into",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "through",
  "with",
  "would",
]);

function promptOverlapSourceLabel(message: PromptBudgetMessage, kind: PromptBudgetSectionKind): string {
  return normalizedLabel(message) || sectionLabel(kind);
}

function promptOverlapChunks(content: string): string[] {
  return content
    .replace(/<[^>]+>/g, " ")
    .split(/(?:\r?\n|(?<=[.!?])\s+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function normalizedOverlapPhrase(chunk: string): string | null {
  const normalized = chunk
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 28) return null;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 6) return null;
  const signalWords = words.filter((word) => word.length >= 4 && !OVERLAP_STOPWORDS.has(word));
  if (signalWords.length < 4) return null;
  return normalized;
}

function displayOverlapPhrase(normalizedPhrase: string): string {
  const phrase = normalizedPhrase.length > 96 ? `${normalizedPhrase.slice(0, 93).trim()}...` : normalizedPhrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function detectPromptContextOverlaps(messages: LlmMessage[]): PromptContextOverlap[] {
  const phraseSources = new Map<string, Set<string>>();

  for (const rawMessage of messages) {
    const message = rawMessage as PromptBudgetMessage;
    const kind = classifyPromptMessage(message);
    if (!OVERLAP_SOURCE_KINDS.has(kind)) continue;
    const sourceLabel = promptOverlapSourceLabel(message, kind);
    const seenInMessage = new Set<string>();

    for (const chunk of promptOverlapChunks(message.content ?? "")) {
      const phrase = normalizedOverlapPhrase(chunk);
      if (!phrase || seenInMessage.has(phrase)) continue;
      seenInMessage.add(phrase);
      const sources = phraseSources.get(phrase) ?? new Set<string>();
      sources.add(sourceLabel);
      phraseSources.set(phrase, sources);
    }
  }

  return [...phraseSources.entries()]
    .map(([phrase, sources]) => ({ phrase, sourceLabels: [...sources] }))
    .filter((overlap) => overlap.sourceLabels.length >= 2)
    .sort(
      (left, right) => right.sourceLabels.length - left.sourceLabels.length || right.phrase.length - left.phrase.length,
    )
    .slice(0, 3);
}

function overlapSourceList(sourceLabels: string[]): string {
  if (sourceLabels.length <= 2) return sourceLabels.join(" and ");
  return `${sourceLabels.slice(0, -1).join(", ")}, and ${sourceLabels[sourceLabels.length - 1]}`;
}
function skippedLorebookName(entry: { name?: unknown; id?: unknown; lorebookId?: unknown }): string {
  return readString(entry.name).trim() || readString(entry.id).trim() || readString(entry.lorebookId).trim() || "entry";
}

function formatBudgetTokens(tokens: number): string {
  return Math.max(0, Math.round(tokens)).toLocaleString("en-US");
}

export function buildPromptBudgetEstimate(input: PromptBudgetInput): PromptBudgetEstimate {
  const parameters = input.parameters ?? {};
  const contextLimit = effectiveMaxContext(input.connection, parameters) || null;
  const estimatedPromptTokens = input.messages.reduce((total, message) => total + estimateLlmMessageTokens(message), 0);
  const outputReserveTokens = contextLimit == null ? null : outputReserve(parameters);
  const safetyReserveTokens = contextLimit == null ? null : CONTEXT_SAFETY_TOKENS;
  const inputBudgetTokens =
    contextLimit == null || outputReserveTokens == null
      ? null
      : Math.max(0, contextLimit - outputReserveTokens - CONTEXT_SAFETY_TOKENS);
  const remainingTokens = inputBudgetTokens == null ? null : inputBudgetTokens - estimatedPromptTokens;
  const sections = buildSections(input.messages, inputBudgetTokens, remainingTokens);
  const warnings: PromptBudgetWarning[] = [];

  if (contextLimit == null) {
    warnings.push({
      kind: "unknown_limit",
      message: "Context limit is unknown for this connection, so remaining tokens can only be estimated.",
    });
  } else if ((remainingTokens ?? 0) < 0) {
    const overageTokens = Math.abs(remainingTokens ?? 0);
    warnings.push({
      kind: "over_budget",
      message: `This prompt is larger than the estimated input budget by about ${formatBudgetTokens(
        overageTokens,
      )} tokens. Aim for about ${formatBudgetTokens(inputBudgetTokens ?? 0)} input tokens or less.`,
      tokens: overageTokens,
    });
  } else if (inputBudgetTokens && remainingTokens != null && remainingTokens <= inputBudgetTokens * 0.1) {
    warnings.push({
      kind: "near_limit",
      message: `This prompt is close to the estimated context limit. Aim to stay under about ${formatBudgetTokens(
        inputBudgetTokens,
      )} input tokens; about ${formatBudgetTokens(remainingTokens)} remain.`,
      tokens: remainingTokens,
    });
  }

  const historySection = sections.find((section) => section.kind === "history");
  if (historySection?.trimRisk === "high") {
    warnings.push({
      kind: "history_trim",
      sectionKind: "history",
      sectionLabel: historySection.label,
      message: "Recent chat history is the most likely section to be trimmed.",
      tokens: historySection.estimatedTokens,
    });
  }

  for (const section of sections) {
    const threshold =
      inputBudgetTokens && inputBudgetTokens > 0
        ? Math.min(LARGE_SECTION_TOKENS, Math.max(400, Math.floor(inputBudgetTokens * 0.25)))
        : LARGE_SECTION_TOKENS;
    if (section.estimatedTokens >= threshold) {
      warnings.push({
        kind: "large_section",
        sectionKind: section.kind,
        sectionLabel: section.label,
        message: `${section.label} is unusually large for this prompt. Try to keep it under about ${formatBudgetTokens(
          threshold,
        )} tokens.`,
        tokens: section.estimatedTokens,
      });
    }
  }

  for (const overlap of detectPromptContextOverlaps(input.messages)) {
    warnings.push({
      kind: "context_overlap",
      message: `Repeated context cue "${displayOverlapPhrase(overlap.phrase)}" appears in ${overlapSourceList(
        overlap.sourceLabels,
      )}. Check overlapping character, memory, summary, lorebook, or injected context before changing prompt selection.`,
      overlapPhrase: overlap.phrase,
      sourceLabels: overlap.sourceLabels,
    });
  }
  const skippedLorebookEntries = input.budgetSkippedLorebookEntries ?? [];
  if (skippedLorebookEntries.length > 0) {
    const first = skippedLorebookName(skippedLorebookEntries[0]!);
    warnings.push({
      kind: "lorebook_skipped",
      sectionKind: "lorebook",
      sectionLabel: sectionLabel("lorebook"),
      message:
        skippedLorebookEntries.length === 1
          ? `Lorebook entry "${first}" was skipped by lorebook budget rules.`
          : `${skippedLorebookEntries.length} lorebook entries were skipped by lorebook budget rules.`,
    });
  }

  return {
    contextLimit,
    estimatedPromptTokens,
    outputReserveTokens,
    safetyReserveTokens,
    inputBudgetTokens,
    remainingTokens,
    sections,
    warnings,
  };
}
